const storageKey = "friend-invite-calendar-v4-blank-ranges";
const scheduleResetKey = "friend-invite-calendar-glass-v41-schedule-reset";
const supabaseUrl = "https://joqosgplspsfrtzcpfwm.supabase.co";
const supabaseKey = "sb_publishable_CF0IXFM6pV8mI6f4MLA80g_EKSc2Tqi";
const supabaseClient = window.supabase?.createClient(supabaseUrl, supabaseKey) || null;
let cloudReady = false;
let cloudSaving = false;
let cloudSaveTimer = null;
let lastCloudError = "";
let bookingSubmitting = false;
const statusText = {
  open: "請約我",
  partial: "請約我",
  pending: "審核預約中",
  booked: "有約",
  closed: "暫不開放",
  note: "暫不開放",
};

const adminStatusOptions = ["open", "pending", "booked", "closed"];

const requestStatusText = {
  pending: "審核預約中",
  approved: "OK",
  change: "需討論",
  declined: "NO",
  done: "已完成",
};

const defaultActivityTypes = [
  { id: "overnight1", label: "申請過1夜", short: "過夜", blocks: 24, template: "{name}，我同意囉！{date} {time} 可以過夜。" },
  { id: "overnight2", label: "申請過2夜", short: "過夜", blocks: 48, template: "{name}，我同意囉！{date} {time} 可以過2夜。" },
  { id: "live3", label: "申請同居3夜", short: "同居", blocks: 72, template: "{name}，我同意囉！{date} {time} 可以同居3夜。" },
  { id: "liveweek", label: "申請同居1周", short: "同居", blocks: 168, template: "{name}，我同意囉！{date} {time} 可以同居1周。" },
  { id: "kidnap", label: "申請綁架妳", short: "綁架", blocks: 6, template: "{name}，綁架申請先通過，我們再細談。" },
  { id: "meal", label: "女人跟我吃飯", short: "吃飯", blocks: 2, template: "{name}，可以吃飯！{date} {time} 見。" },
  { id: "outing", label: "女人跟我走", short: "出門", blocks: 4, template: "{name}，可以出門！我先留 {date} {time}。" },
  { id: "game", label: "女人打game", short: "game", blocks: 3, template: "{name}，可以打 game！{date} {time} 開局。" },
  { id: "chat", label: "女人咱們聊聊", short: "聊聊", blocks: 2, template: "{name}，可以聊聊，我先留 {date} {time}。" },
  { id: "note", label: "我要說悄悄話", short: "有留言", blocks: 1, template: "{name}，我收到你的悄悄話了。" },
];

let activityTypes = structuredClone(defaultActivityTypes);

const defaultBookingTimes = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 ? "30" : "00";
  return `${String(hour).padStart(2, "0")}:${minute}`;
});

const defaultData = {
  settings: {
    heroEyebrow: "for close friends",
    heroTitle: "妳想約約ㄇ",
    heroBody: "看看我哪天有空。點綠色日期就可以送出預約申請。",
    howKicker: "how it works",
    howTitle: "怎麼使用",
    howBody: "點綠色日期，填小窗送出預約。\n我同意後，行事曆會同步更新。\n已同意的時段不能重複申請。",
    howVisible: true,
  },
  activityTypes: structuredClone(defaultActivityTypes),
  calendar: [],
  requests: [],
};

let data = normalizeData(loadData());
resetScheduleOnce();
activityTypes = data.activityTypes;
let session = null;
let activeView = "public";
let currentMonth = new Date(2026, 6, 1);
let selectedDateKey = "";
let selectedAdminDateKey = "";
let selectedAdminRequestDateKey = "";
let recentlySyncedRequestId = "";
let adminReviewNotice = "";
let adminCalendarNotice = "";
let selectedActivityTypeId = activityTypes[0]?.id || "";
let typeEditorNotice = "";
let editingGroup = "";

const editGroups = {
  hero: ["heroEyebrow", "heroTitle", "heroBody"],
  how: ["howKicker", "howTitle", "howBody"],
};

function $(selector) {
  return document.querySelector(selector);
}

function loadData() {
  const stored = localStorage.getItem(storageKey);
  return stored ? JSON.parse(stored) : structuredClone(defaultData);
}

function normalizeData(raw) {
  const next = { ...structuredClone(defaultData), ...raw };
  next.settings = { ...defaultData.settings, ...(raw.settings || {}) };
  if (next.settings.heroTitle === "你想約約ㄇ") next.settings.heroTitle = "妳想約約ㄇ";
  next.activityTypes = Array.isArray(raw.activityTypes) && raw.activityTypes.length
    ? raw.activityTypes.map((type) => normalizeActivityType(type))
    : structuredClone(defaultActivityTypes);
  activityTypes = next.activityTypes;
  next.calendar = (Array.isArray(raw.calendar) ? raw.calendar : structuredClone(defaultData.calendar)).map((day) => normalizeCalendarDay(day));
  next.requests = Array.isArray(raw.requests) ? raw.requests.map((request) => normalizeRequest(request)) : [];
  reconcileCalendarRequestSync(next);
  return next;
}

function normalizeActivityType(type) {
  return {
    id: type.id || createId("type"),
    code: type.code || "",
    label: type.label || "新邀約類型",
    short: type.short || "邀約",
    blocks: Number(type.blocks) || 1,
    template: type.template || "{name}，我收到你的邀約了。",
  };
}

function normalizeCalendarDay(day) {
  return {
    date: day.date || "",
    status: day.status || "closed",
    memo: day.memo || "",
    availableTimes: Array.isArray(day.availableTimes) ? day.availableTimes.filter(Boolean) : [],
    publicStatus: day.publicStatus || "",
    publicEvent: day.publicEvent || "",
    publicRequest: day.publicRequest || "",
    publicRemaining: day.publicRemaining || "",
    requestSyncIds: Array.isArray(day.requestSyncIds) ? day.requestSyncIds : [],
  };
}

function normalizeRequest(request) {
  const legacyFriend = request.friendId === "yu" ? "小羽" : request.friendId === "mei" ? "小美" : "";
  const type = getActivity(request.activityId || request.typeId) || activityTypes[0];
  return {
    id: request.id || createId("req"),
    name: request.name || legacyFriend || "朋友",
    activityId: type.id,
    date: request.date || "",
    time: request.time || "",
    endTime: request.endTime || "",
    leaveAt: request.leaveAt || "",
    message: request.message || "",
    status: request.status || "pending",
    sentStatus: request.sentStatus || "pending",
    adminNote: request.adminNote || "",
    replyDraft: request.replyDraft || "",
    sentReply: request.sentReply || "",
    sentAdminNote: request.sentAdminNote || "",
    syncedAt: request.syncedAt || "",
    createdAt: request.createdAt || new Date().toISOString().slice(0, 10),
    updatedAt: request.updatedAt || "",
  };
}

function reconcileCalendarRequestSync(dataset) {
  dataset.calendar.forEach((day) => {
    const requests = dataset.requests.filter((request) => request.date === day.date);
    const hasRequestLinkedCalendar =
      day.publicRequest === "目前收到來自公主的邀請。" ||
      requests.some((request) => calendarLooksLinkedToRequest(day, request));
    if (!hasRequestLinkedCalendar) return;

    const approved = requests.filter((request) => request.status === "approved");

    if (approved.length) {
      const reservedTimes = new Set(approved.flatMap((request) => reservedTimesForRequest(request)));
      const baseTimes = sortTimes([...day.availableTimes, ...reservedTimes]);
      const remainingTimes = sortTimes(baseTimes).filter((time) => !reservedTimes.has(time));
      day.availableTimes = remainingTimes;
      day.status = remainingTimes.length ? "partial" : "booked";
      return;
    }

    const restoredTimes = sortTimes([...(day.availableTimes || []), ...requests.flatMap((request) => reservedTimesForRequest(request))]);
    const linkedRequest = requests.find((request) => calendarLooksLinkedToRequest(day, request)) || requests[0];
    day.availableTimes = restoredTimes;
    day.status = restoredTimes.length ? "partial" : "closed";
    if (linkedRequest) {
      clearRequestGeneratedCalendarText(day, linkedRequest);
    } else {
      day.publicStatus = "";
      day.publicEvent = "";
      day.publicRequest = "";
      day.publicRemaining = "";
      day.requestSyncIds = [];
    }
  });
}

function saveData(options = {}) {
  localStorage.setItem(storageKey, JSON.stringify(data));
  if (options.cloud !== false) queueCloudSave();
}

function resetScheduleOnce() {
  if (localStorage.getItem(scheduleResetKey)) return;
  data.calendar = [];
  data.requests = [];
  localStorage.setItem(scheduleResetKey, "done");
  saveData();
}
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function normalizeDbTime(value) {
  return value ? String(value).slice(0, 5) : "";
}

function settingsFromRow(row) {
  return {
    heroEyebrow: row?.hero_eyebrow || defaultData.settings.heroEyebrow,
    heroTitle: row?.hero_title || defaultData.settings.heroTitle,
    heroBody: row?.hero_body || defaultData.settings.heroBody,
    howKicker: row?.how_kicker || defaultData.settings.howKicker,
    howTitle: row?.how_title || defaultData.settings.howTitle,
    howBody: row?.how_body || defaultData.settings.howBody,
    howVisible: row?.how_visible !== false,
  };
}

function settingsToRow(settings) {
  return {
    id: "main",
    hero_eyebrow: settings.heroEyebrow || defaultData.settings.heroEyebrow,
    hero_title: settings.heroTitle || defaultData.settings.heroTitle,
    hero_body: settings.heroBody || defaultData.settings.heroBody,
    how_kicker: settings.howKicker || defaultData.settings.howKicker,
    how_title: settings.howTitle || defaultData.settings.howTitle,
    how_body: settings.howBody || defaultData.settings.howBody,
    how_visible: settings.howVisible !== false,
  };
}

function activityFromRow(row) {
  return normalizeActivityType({
    id: row.id,
    code: row.code || "",
    label: row.label,
    short: row.short_label,
    blocks: row.blocks,
    template: row.reply_template,
  });
}

function activityToRow(type, index) {
  const row = {
    label: type.label || "新邀約類型",
    short_label: type.short || "邀約",
    blocks: Number(type.blocks) || 1,
    reply_template: type.template || "{name}，我收到你的邀約了。",
    active: true,
    sort_order: (index + 1) * 10,
  };
  if (isUuid(type.id)) row.id = type.id;
  if (type.code || !isUuid(type.id)) row.code = type.code || type.id;
  return row;
}

function calendarFromRow(row) {
  return normalizeCalendarDay({
    date: row.date,
    status: row.status,
    memo: row.memo,
    availableTimes: row.available_times || [],
    publicStatus: row.public_status,
    publicEvent: row.public_event,
    publicRequest: row.public_request,
    publicRemaining: row.public_remaining,
    requestSyncIds: row.request_sync_ids || [],
  });
}

function calendarToRow(day) {
  return {
    date: day.date,
    status: day.status || "closed",
    memo: day.memo || "",
    public_status: day.publicStatus || "",
    public_event: day.publicEvent || "",
    public_request: day.publicRequest || "",
    public_remaining: day.publicRemaining || "",
    available_times: sortTimes(day.availableTimes || []),
    request_sync_ids: (day.requestSyncIds || []).filter(isUuid),
  };
}

function requestFromRow(row) {
  const activity = activityTypes.find((type) => type.id === row.activity_type_id) || activityTypes.find((type) => type.code === row.activity_code || type.id === row.activity_code) || activityTypes[0];
  return normalizeRequest({
    id: row.id,
    name: row.name,
    activityId: activity?.id,
    date: row.request_date,
    time: normalizeDbTime(row.start_time),
    endTime: normalizeDbTime(row.end_time),
    message: row.message,
    status: row.status,
    adminNote: row.admin_note,
    replyDraft: row.reply_draft,
    sentStatus: row.sent_status,
    sentReply: row.sent_reply,
    sentAdminNote: row.sent_admin_note,
    syncedAt: row.synced_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  });
}

function requestToRow(request) {
  const type = getActivity(request.activityId);
  const row = {
    name: request.name || "朋友",
    activity_type_id: isUuid(request.activityId) ? request.activityId : null,
    activity_code: type?.code || (!isUuid(request.activityId) ? request.activityId : null),
    request_date: request.date,
    start_time: request.time || null,
    end_time: request.endTime || null,
    message: request.message || "",
    status: request.status || "pending",
    admin_note: request.adminNote || "",
    reply_draft: request.replyDraft || "",
    sent_status: request.sentStatus || request.status || "pending",
    sent_reply: request.sentReply || "",
    sent_admin_note: request.sentAdminNote || "",
    synced_at: request.syncedAt || null,
  };
  if (isUuid(request.id)) row.id = request.id;
  return row;
}

async function loadCloudData() {
  if (!supabaseClient) return;
  try {
    const [settingsResult, typesResult, calendarResult] = await Promise.all([
      supabaseClient.from("app_settings").select("*").eq("id", "main").maybeSingle(),
      supabaseClient.from("activity_types").select("*").eq("active", true).order("sort_order"),
      supabaseClient.from("calendar_days").select("*").order("date"),
    ]);

    if (settingsResult.error) throw settingsResult.error;
    if (typesResult.error) throw typesResult.error;
    if (calendarResult.error) throw calendarResult.error;

    const next = structuredClone(defaultData);
    next.settings = settingsFromRow(settingsResult.data);
    next.activityTypes = typesResult.data?.length ? typesResult.data.map(activityFromRow) : structuredClone(defaultActivityTypes);
    activityTypes = next.activityTypes;
    next.calendar = (calendarResult.data || []).map(calendarFromRow);
    next.requests = [];

    if (session?.role === "admin") {
      const requestsResult = await supabaseClient.from("invite_requests").select("*").order("created_at", { ascending: false });
      if (requestsResult.error) throw requestsResult.error;
      next.requests = (requestsResult.data || []).map(requestFromRow);
    }

    data = normalizeData(next);
    activityTypes = data.activityTypes;
    cloudReady = true;
    lastCloudError = "";
    if (session?.role === "admin" && repairBlockingRequestCalendarSync()) saveData();
    else saveData({ cloud: false });
  } catch (error) {
    cloudReady = false;
    lastCloudError = error.message || "雲端資料讀取失敗";
    console.warn(lastCloudError, error);
  }
}

function queueCloudSave() {
  if (!supabaseClient || !cloudReady) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    saveCloudData();
  }, 700);
}

async function saveCloudData() {
  if (!supabaseClient || !cloudReady || cloudSaving) return;
  cloudSaving = true;
  try {
    const settingsRow = settingsToRow(data.settings);
    const typeRows = activityTypes.map(activityToRow);
    const calendarRows = data.calendar.filter((day) => day.date).map(calendarToRow);

    let result = await supabaseClient.from("app_settings").upsert(settingsRow, { onConflict: "id" });
    if (result.error) throw result.error;

    if (typeRows.length) {
      result = await supabaseClient.from("activity_types").upsert(typeRows);
      if (result.error) throw result.error;
    }

    if (calendarRows.length) {
      result = await supabaseClient.from("calendar_days").upsert(calendarRows, { onConflict: "date" });
      if (result.error) throw result.error;
    }

    if (session?.role === "admin") {
      const requestRows = data.requests.filter((request) => isUuid(request.id)).map(requestToRow);
      if (requestRows.length) {
        result = await supabaseClient.from("invite_requests").upsert(requestRows);
        if (result.error) throw result.error;
      }
    }

    lastCloudError = "";
  } catch (error) {
    lastCloudError = error.message || "雲端儲存失敗";
    console.warn(lastCloudError, error);
  } finally {
    cloudSaving = false;
  }
}

async function hydrateSession() {
  if (!supabaseClient) return;
  const { data: authData } = await supabaseClient.auth.getSession();
  const user = authData.session?.user;
  if (!user) return;
  const { data: isAdmin } = await supabaseClient.rpc("is_admin");
  if (isAdmin) session = { role: "admin", id: user.id, name: "我的後台", email: user.email };
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(date) {
  if (!date) return "未指定日期";
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(Date.UTC(year, month - 1, day, 4, 0, 0)));
}

function getActivity(id) {
  return activityTypes.find((type) => type.id === id) || null;
}

function getCalendarDay(dateKey) {
  let day = data.calendar.find((item) => item.date === dateKey);
  if (!day) {
    day = normalizeCalendarDay({ date: dateKey, status: "closed", memo: "" });
    data.calendar.push(day);
    data.calendar.sort((a, b) => a.date.localeCompare(b.date));
  }
  return day;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inferredRequestEndTime(request) {
  if (request.endTime) return request.endTime;
  const start = normalizeTime(request.time);
  const startIndex = defaultBookingTimes.indexOf(start);
  if (startIndex < 0) return "";
  const activity = getActivity(request.activityId);
  const blockCount = Math.max(1, Math.ceil(Number(activity?.blocks || 1) * 2));
  const endIndex = Math.min(defaultBookingTimes.length, startIndex + blockCount);
  return defaultBookingTimes[endIndex] || "24:00";
}

function formatRequestTimeRange(request) {
  const start = normalizeTime(request.time);
  if (!start) return "未指定時間";
  const end = inferredRequestEndTime(request);
  return end && end !== start ? `${start}-${end}` : start;
}
function buildReply(request) {
  const activity = getActivity(request.activityId) || activityTypes[0];
  return activity.template
    .replaceAll("{name}", request.name || "朋友")
    .replaceAll("{date}", formatDate(request.date))
    .replaceAll("{time}", formatRequestTimeRange(request) || "那天");
}

function buildTimeOptions(timesOrDate, selectedValue = "") {
  const times = Array.isArray(timesOrDate) ? timesOrDate : availableTimesForDate(timesOrDate);
  if (!times.length) return `<option value="">目前沒有尚可預約的時間</option>`;
  return times.map((value) => `<option value="${value}" ${value === selectedValue ? "selected" : ""}>${value}</option>`).join("");
}

function buildEndTimeOptions(start, availableTimes, selectedValue = "") {
  const startIndex = defaultBookingTimes.indexOf(normalizeTime(start));
  const availableSet = new Set(availableTimes);
  const endOptions = [];
  for (let index = startIndex + 1; index <= defaultBookingTimes.length; index += 1) {
    const previousSlot = defaultBookingTimes[index - 1];
    const endValue = defaultBookingTimes[index] || "24:00";
    if (!availableSet.has(previousSlot)) break;
    if (endValue !== "24:00" && !availableSet.has(endValue)) break;
    endOptions.push(endValue);
  }
  if (!endOptions.length) return `<option value="">請先選開始時間</option>`;
  return endOptions.map((value) => `<option value="${value}" ${value === selectedValue ? "selected" : ""}>${value}</option>`).join("");
}

function updateBookingEndOptions() {
  const date = $("#bookingDate")?.value || "";
  const start = $("#bookingStartTime")?.value || "";
  const availableTimes = availableTimesForDate(date);
  const endSelect = $("#bookingEndTime");
  if (!endSelect) return;
  endSelect.innerHTML = buildEndTimeOptions(start, availableTimes, endSelect.value);
}

function timesInBookingRange(start, end) {
  const startIndex = defaultBookingTimes.indexOf(normalizeTime(start));
  const endValue = end === "24:00" ? "24:00" : normalizeTime(end);
  const endIndex = endValue === "24:00" ? defaultBookingTimes.length : defaultBookingTimes.indexOf(endValue);
  if (startIndex < 0 || endIndex <= startIndex) return [];
  return defaultBookingTimes.slice(startIndex, endIndex);
}

function requestConflicts(date, start, end, ignoredId = "", blockingStatuses = null) {
  const requestedTimes = new Set(timesInBookingRange(start, end));
  if (!requestedTimes.size) return false;
  const blockingSet = blockingStatuses ? new Set(blockingStatuses) : null;
  return data.requests.some((request) => {
    if (request.id === ignoredId || request.date !== date) return false;
    if (blockingSet ? !blockingSet.has(request.status) : request.status === "declined" || request.status === "done") return false;
    return reservedTimesForRequest(request).some((time) => requestedTimes.has(time));
  });
}

function sortTimes(times) {
  return [...new Set(times)].sort((a, b) => defaultBookingTimes.indexOf(a) - defaultBookingTimes.indexOf(b));
}

function reservedTimesForRequest(request) {
  const explicitRange = timesInBookingRange(request.time, request.endTime);
  if (explicitRange.length) return explicitRange;
  const start = normalizeTime(request.time);
  const startIndex = defaultBookingTimes.indexOf(start);
  if (startIndex < 0) return start ? [start] : [];
  const activity = getActivity(request.activityId);
  const blockCount = Math.max(1, Math.ceil(Number(activity?.blocks || 1) * 2));
  return defaultBookingTimes.slice(startIndex, Math.min(defaultBookingTimes.length, startIndex + blockCount));
}

function parseTimesInput(value) {
  const tokens = String(value || "")
    .split(/[,\n、，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const times = [];
  tokens.forEach((token) => {
    const range = token.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
    if (range) {
      const startIndex = defaultBookingTimes.indexOf(normalizeTime(range[1]));
      const endIndex = defaultBookingTimes.indexOf(normalizeTime(range[2]));
      if (startIndex >= 0 && endIndex >= startIndex) times.push(...defaultBookingTimes.slice(startIndex, endIndex + 1));
      return;
    }
    const time = normalizeTime(token);
    if (defaultBookingTimes.includes(time)) times.push(time);
  });
  return [...new Set(times)];
}

function normalizeTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

function timesInRange(start, end) {
  const startIndex = defaultBookingTimes.indexOf(normalizeTime(start));
  const endIndex = defaultBookingTimes.indexOf(normalizeTime(end));
  if (startIndex < 0 || endIndex < startIndex) return [];
  return defaultBookingTimes.slice(startIndex, endIndex + 1);
}

function presetTimes(preset) {
  if (preset === "all") return defaultBookingTimes;
  if (preset === "morning") return timesInRange("08:00", "11:30");
  if (preset === "afternoon") return timesInRange("12:00", "17:30");
  if (preset === "evening") return timesInRange("18:00", "23:30");
  if (preset === "clear") return [];
  return [];
}

function isAdminBookableStatus(status) {
  return status === "open";
}

function syncAdminTimePickerVisibility(dateKey) {
  const status = document.querySelector(`[data-admin-calendar-status="${dateKey}"]`)?.value || "closed";
  const isBookable = isAdminBookableStatus(status);
  const picker = document.querySelector(`[data-time-picker="${dateKey}"]`);
  const hint = document.querySelector(`[data-time-picker-hint="${dateKey}"]`);
  const input = document.querySelector(`[data-admin-calendar-times="${dateKey}"]`);
  picker?.classList.toggle("hidden", !isBookable);
  hint?.classList.toggle("hidden", !isBookable);
  picker?.querySelectorAll("button, select").forEach((control) => {
    control.disabled = !isBookable;
  });
  if (!isBookable && input) input.value = "";
  renderAdminTimeChips(dateKey);
  renderAdminDraftPreview(dateKey);
}
function selectedAdminTimes(dateKey) {
  const input = document.querySelector(`[data-admin-calendar-times="${dateKey}"]`);
  return input ? parseTimesInput(input.value) : [];
}

function setAdminTimeSelection(dateKey, times) {
  const input = document.querySelector(`[data-admin-calendar-times="${dateKey}"]`);
  if (input) input.value = sortTimes(times).join("、");
  renderAdminTimeChips(dateKey);
  renderAdminDraftPreview(dateKey);
  adminCalendarNotice = "";
  $("#adminCalendarSaved")?.classList.add("hidden");
}

function renderAdminTimeChips(dateKey) {
  const grid = document.querySelector(`[data-admin-time-grid="${dateKey}"]`);
  const count = document.querySelector(`[data-admin-time-count="${dateKey}"]`);
  if (!grid) return;
  const selected = new Set(selectedAdminTimes(dateKey));
  grid.innerHTML = defaultBookingTimes
    .map((time) => `<button class="time-chip ${selected.has(time) ? "selected" : ""}" type="button" data-time-chip="${dateKey}" data-time-value="${time}">${time}</button>`)
    .join("");
  if (count) count.textContent = selected.size ? `已開放 ${selected.size} 個時段` : "尚未開放時段";
}

function renderAdminDraftPreview(dateKey) {
  const target = document.querySelector(`[data-admin-front-preview="${dateKey}"]`);
  if (!target) return;
  const savedDay = getCalendarDay(dateKey);
  const draftDay = {
    ...savedDay,
    status: document.querySelector(`[data-admin-calendar-status="${dateKey}"]`)?.value || savedDay.status,
    memo: document.querySelector(`[data-admin-calendar-memo="${dateKey}"]`)?.value || "",
    publicStatus: document.querySelector(`[data-admin-calendar-public-status="${dateKey}"]`)?.value || "",
    availableTimes: selectedAdminTimes(dateKey),
  };
  const draftTimes = isAdminBookableStatus(draftDay.status) ? availableTimesForDate(dateKey, draftDay) : [];
  const preview = dayPublicDetail(draftDay, dateKey, summarizeRequests(dateKey), draftTimes);
  target.innerHTML = `
    <p class="card-kicker">front preview</p>
    <p><strong>\u72c0\u614b\uff1a</strong>${escapeHtml(preview.status)}</p>
    ${preview.schedule ? `<p><strong>\u6211\u7684\u884c\u7a0b\u5b89\u6392\uff1a</strong>${escapeHtml(preview.schedule)}</p>` : ""}
    ${preview.remaining !== "no" ? `<p><strong>\u5269\u9918\u53ef\u7d04\u6642\u9593\uff1a</strong>${escapeHtml(preview.remaining)}</p>` : ""}
  `;
}

function renderAdminTimePicker(dateKey, day) {
  const isBookable = isAdminBookableStatus(day.status);
  const initialTimes = isBookable && day.availableTimes?.length ? day.availableTimes : [];
  const options = defaultBookingTimes.map((time) => `<option value="${time}">${time}</option>`).join("");
  return `
    <section class="time-picker ${isBookable ? "" : "hidden"}" data-time-picker="${dateKey}">
      <div class="time-picker-head">
        <div>
          <p class="card-kicker">available time</p>
          <h3>尚可預約時間</h3>
        </div>
        <span data-admin-time-count="${dateKey}"></span>
      </div>
      <input type="hidden" data-admin-calendar-times="${dateKey}" value="${escapeHtml(sortTimes(initialTimes).join("、"))}" />
      <div class="time-presets" aria-label="快速選擇時段">
        <button type="button" data-time-preset="all" data-time-date="${dateKey}">全天</button>
        <button type="button" data-time-preset="morning" data-time-date="${dateKey}">上午</button>
        <button type="button" data-time-preset="afternoon" data-time-date="${dateKey}">下午</button>
        <button type="button" data-time-preset="evening" data-time-date="${dateKey}">晚上</button>
        <button type="button" data-time-preset="clear" data-time-date="${dateKey}">清空</button>
      </div>
      <div class="time-range-row">
        <label>從<select data-time-range-start="${dateKey}">${options}</select></label>
        <label>到<select data-time-range-end="${dateKey}">${options}</select></label>
        <button type="button" data-time-range-add="${dateKey}">加入</button>
      </div>
      <div class="time-chip-grid" data-admin-time-grid="${dateKey}"></div>
    </section>
  `;
}

function memoHintTimes(day) {
  return [];
}

function baseAvailableTimes(day) {
  if (!(day.status === "open" || day.status === "partial")) return [];
  return sortTimes(day.availableTimes || []);
}

function isDayBookable(day, dateKey) {
  return availableTimesForDate(dateKey, day).length > 0;
}

function summarizeRequests(dateKey) {
  return data.requests.filter((request) => request.date === dateKey && request.status !== "done");
}

function dayVisualStatus(day, requests) {
  const hasApproved = requests.some((request) => request.status === "approved");
  const hasBusyReview = !hasApproved && requests.some((request) => request.status === "change" || request.status === "declined");
  const hasWaiting = requests.some((request) => request.status === "pending");
  const hasAvailability = isDayBookable(day, day.date);
  if (hasBusyReview) return "closed";
  if (hasWaiting) return "pending";
  if (hasApproved) return hasAvailability ? "partial" : "booked";
  if (hasAvailability) return day.status === "partial" ? "partial" : "open";
  return day.status;
}

function showView(view) {
  if (view === "admin" && session?.role !== "admin") {
    $("#loginDialog").showModal();
    view = activeView;
  }
  activeView = view;
  ["public", "admin"].forEach((name) => {
    $(`#${name}View`).classList.toggle("hidden", name !== view);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  render();
}

function render() {
  renderLogin();
  renderIntro();
  renderHowItWorks();
  renderMonth();
  renderPublicRequests();
  renderAdmin();
}

function renderLogin() {
  $("#loginFields").classList.toggle("hidden", !!session);
  $("#sessionBox").classList.toggle("hidden", !session);
  $("#loginTitle").textContent = session ? `已登入：${session.name}` : "管理者登入";
  $("#sessionText").textContent = session ? "目前身份：我的後台" : "";
  $("#topLogoutButton").classList.toggle("hidden", !session);
  const overviewButton = document.querySelector('[data-view="public"]');
  const reviewButton = document.querySelector('[data-view="admin"]');
  if (overviewButton) {
    overviewButton.textContent = session?.role === "admin" ? "總覽" : "首頁";
    overviewButton.setAttribute("aria-label", session?.role === "admin" ? "總覽" : "首頁");
  }
  if (reviewButton) {
    reviewButton.textContent = session?.role === "admin" ? "審核" : "管理者";
    reviewButton.setAttribute("aria-label", session?.role === "admin" ? "審核" : "管理者");
  }
}

function editableBlock(selector, settingKey, multiline = false) {
  const target = $(selector);
  const value = data.settings[settingKey] || "";
  const groupName = settingKey.startsWith("hero") ? "hero" : "how";
  if (session?.role !== "admin" || editingGroup !== groupName) {
    target.innerHTML = multiline ? escapeHtml(value).replaceAll("\n", "<br>") : escapeHtml(value);
    return;
  }
  target.innerHTML = `
    <span class="editable-copy" contenteditable="true" data-editing-setting="${settingKey}" data-original="${escapeHtml(value)}">${multiline ? escapeHtml(value).replaceAll("\n", "<br>") : escapeHtml(value)}</span>
  `;
}

function renderIntro() {
  editableBlock("#heroEyebrow", "heroEyebrow");
  editableBlock("#heroTitle", "heroTitle");
  editableBlock("#heroBody", "heroBody");
  $("#heroEditToggle").classList.toggle("hidden", session?.role !== "admin" || editingGroup === "hero");
  $("#heroEditActions").classList.toggle("hidden", session?.role !== "admin" || editingGroup !== "hero");
  $(".brand").textContent = data.settings.heroTitle || "妳想約約ㄇ";
  document.title = data.settings.heroTitle || "妳想約約ㄇ";
}

function renderHowItWorks() {
  const visible = data.settings.howVisible !== false;
  const isAdmin = session?.role === "admin";
  const panel = document.querySelector(".how-panel");
  panel?.classList.toggle("hidden", !visible && !isAdmin);
  panel?.classList.toggle("collapsed", !visible);
  editableBlock("#howKicker", "howKicker");
  editableBlock("#howTitle", "howTitle");
  editableBlock("#howBody", "howBody", true);
  $("#howBody").classList.toggle("hidden", !visible);
  $("#howTitle").classList.toggle("hidden", !visible);
  $("#howKicker").classList.toggle("hidden", !visible);
  $("#howEyeToggle").classList.toggle("hidden", !isAdmin);
  $("#howEyeToggle").setAttribute("aria-pressed", String(visible));
  $("#howEyeToggle").setAttribute("title", visible ? "隱藏留言板" : "開啟留言板");
  $("#howEyeToggle").classList.toggle("muted", !visible);
  $("#howEditToggle").classList.toggle("hidden", !isAdmin || editingGroup === "how" || !visible);
  $("#howEditActions").classList.toggle("hidden", !isAdmin || editingGroup !== "how" || !visible);
}

function applyEditAction(groupName, action) {
  const keys = editGroups[groupName] || [];
  if (!keys.length) return;

  if (action === "save") {
    keys.forEach((key) => {
      const copy = document.querySelector(`[data-editing-setting="${key}"]`);
      if (copy) data.settings[key] = copy.innerText.trim();
    });
    saveData();
    editingGroup = "";
    render();
    return;
  }

  if (action === "restore") {
    keys.forEach((key) => {
      const copy = document.querySelector(`[data-editing-setting="${key}"]`);
      if (copy) copy.innerText = data.settings[key] || defaultData.settings[key] || "";
    });
    return;
  }

  if (action === "cancel") {
    editingGroup = "";
    render();
  }
}

function renderMonth() {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  $("#monthTitle").textContent = `${year} 年 ${month + 1} 月`;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const dayMap = new Map(data.calendar.map((day) => [day.date, day]));
  const cells = [];

  for (let i = 0; i < firstDay.getDay(); i += 1) cells.push(`<div class="month-day blank"></div>`);

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(year, month, day);
    const key = toDateKey(date);
    const base = dayMap.get(key) || normalizeCalendarDay({ date: key, status: "closed", memo: "" });
    const requests = summarizeRequests(key);
    const visualStatus = dayVisualStatus(base, requests);
    const hasApprovedRequest = requests.some((request) => request.status === "approved");
    const hasBusyReview = !hasApprovedRequest && requests.some((request) => request.status === "change" || request.status === "declined");
    const canBook = !hasBusyReview && isDayBookable(base, key);
    const hasPublicContext = requests.some((request) => request.status !== "done");
    const defaultPublicStatus = statusText[base.status] || "";
    const customPublicStatus = (base.publicStatus || "").trim();
    const hasCustomPublicStatus = customPublicStatus && customPublicStatus !== defaultPublicStatus;
    const hasCustomScheduleNote = !canBook && !hasPublicContext && (!!(base.memo || "").trim() || hasCustomPublicStatus);
    const actionAttribute = session?.role === "admin"
      ? `data-admin-date-key="${key}" aria-label="編輯 ${formatDate(key)}"`
      : `data-view-date="${key}" aria-label="查看 ${formatDate(key)} 的狀態"`;
    const tagHtml = "";

    cells.push(`
      <button type="button" class="month-day ${visualStatus} ${canBook ? "selectable" : "unavailable"} ${session?.role === "admin" || !canBook ? "status-visible" : ""} ${selectedDateKey === key || selectedAdminDateKey === key ? "selected" : ""}" ${actionAttribute}>
        <span class="day-number">${day}</span>
        ${canBook ? `<span class="availability-dot" aria-hidden="true"></span>` : ""}
        ${hasCustomScheduleNote ? `<span class="custom-status-dot" aria-hidden="true"></span>` : ""}
        ${tagHtml ? `<span class="day-tags">${tagHtml}</span>` : ""}
      </button>
    `);
  }

  $("#monthGrid").innerHTML = cells.join("");
  const detailKey = session?.role === "admin" ? selectedAdminDateKey : selectedDateKey;
  const selectedDate = detailKey ? new Date(`${detailKey}T00:00:00`) : null;
  if (selectedDate?.getFullYear() === year && selectedDate?.getMonth() === month) {
    if (session?.role === "admin") renderAdminDayEditor("#dayDetail");
    else renderDayDetail(detailKey);
  } else {
    $("#dayDetail").innerHTML = "";
  }
}

function availableTimesForDate(dateKey, existingDay = null) {
  const day = existingDay || getCalendarDay(dateKey);
  const approvedTimes = new Set(
    data.requests
      .filter((request) => request.date === dateKey && request.status !== "declined" && request.status !== "done")
      .flatMap((request) => reservedTimesForRequest(request))
  );
  return baseAvailableTimes(day).filter((time) => !approvedTimes.has(time));
}

function bookedStatusText(request) {
  const shortLabel = getActivity(request.activityId)?.short || "邀約";
  return `在 ${formatRequestTimeRange(request)} 我已被約走｜${shortLabel}`;
}
function activityPublicEvent(request) {
  const activity = getActivity(request.activityId);
  if (!activity) return "和女人\"約約\"";
  if (request.activityId === "kidnap") return "被女人綁架";
  if (request.activityId.startsWith("live")) return "和女人\"同居\"";
  if (request.activityId.startsWith("overnight")) return "和女人\"過夜\"";
  return `和女人"${activity.short || activity.label}"`;
}

function dayPublicDetail(day, dateKey, requests, availableTimes) {
  const approved = requests.find((request) => request.status === "approved");
  const busyRequest = requests.find((request) => request.status === "change" || request.status === "declined");
  const waitingRequest = requests.find((request) => request.status === "pending");
  const hasBusyRequest = !approved && !!busyRequest;
  const hasWaitingRequest = !!waitingRequest;
  const customStatus = (day.publicStatus || "").trim();
  const fallbackStatus =
    approved
      ? bookedStatusText(approved)
      : hasBusyRequest
        ? "busy"
        : hasWaitingRequest
          ? requestStatusText[waitingRequest.status] || "\u5be9\u6838\u9810\u7d04\u4e2d"
          : availableTimes.length
            ? "\u8acb\u7d04\u6211"
            : statusText[day.status] || day.status;
  const status = customStatus || fallbackStatus;
  const schedule = (day.memo || "").trim();
  const remaining = hasBusyRequest
    ? "no"
    : availableTimes.length
      ? `${availableTimes.slice(0, 8).join("\u3001")}${availableTimes.length > 8 ? `\uff0c\u9084\u6709 ${availableTimes.length - 8} \u500b\u6642\u6bb5` : ""}`
      : "no";
  return { status, schedule, remaining };
}

function renderDayDetail(dateKey) {
  const day = getCalendarDay(dateKey);
  const requests = summarizeRequests(dateKey);
  const visualStatus = dayVisualStatus(day, requests);
  const hasApprovedRequest = requests.some((request) => request.status === "approved");
  const hasBusyReview = !hasApprovedRequest && requests.some((request) => request.status === "change" || request.status === "declined");
  const availableTimes = hasBusyReview ? [] : availableTimesForDate(dateKey);
  const publicDetail = dayPublicDetail(day, dateKey, requests, availableTimes);

  $("#dayDetail").innerHTML = `
    <section class="day-detail ${visualStatus}">
      <div>
        <p class="card-kicker">date detail</p>
        <h3>${formatDate(dateKey)}</h3>
      </div>
      <p><strong>\u72c0\u614b\uff1a</strong>${escapeHtml(publicDetail.status)}</p>
      ${publicDetail.schedule ? `<p><strong>\u6211\u7684\u884c\u7a0b\u5b89\u6392\uff1a</strong>${escapeHtml(publicDetail.schedule)}</p>` : ""}
      ${publicDetail.remaining !== "no" ? `<p><strong>\u5269\u9918\u53ef\u7d04\u6642\u9593\uff1a</strong>${escapeHtml(publicDetail.remaining)}</p>` : ""}
      ${availableTimes.length ? `<button class="primary-button" type="button" data-book-from-detail="${dateKey}">\u9ede\u6211\u770b\u5176\u4ed6\u6642\u9593</button>` : ""}
    </section>
  `;
}
function requestNeedsReview(request) {
  return request.status === "pending" || request.status === "change";
}

function discussionReply(request) {
  return `${request.name || "朋友"}的這個時間我要改晚一點你OK嗎?`;
}

function declinedReply() {
  return "這個時間我不行了，改約XXX天可以嗎?";
}

function renderAdminRequestCalendar() {
  const target = $("#adminRequests");
  if (!target) return;
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const cells = [];
  const monthRequests = data.requests.filter((request) => {
    if (!request.date) return false;
    const requestDate = new Date(`${request.date}T00:00:00`);
    return requestDate.getFullYear() === year && requestDate.getMonth() === month;
  });
  const reviewCount = monthRequests.filter(requestNeedsReview).length;

  for (let i = 0; i < firstDay.getDay(); i += 1) cells.push(`<div class="month-day blank"></div>`);

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(year, month, day);
    const key = toDateKey(date);
    const requests = getRequestsForDate(key);
    const needsReview = requests.some(requestNeedsReview);
    const approvedCount = requests.filter((request) => request.status === "approved").length;
    const requestCount = requests.length;
    const tag = needsReview ? "\u5f85\u5be9" : approvedCount ? "OK" : requestCount ? "\u5df2\u8655\u7406" : "";
    const element = requestCount ? "button" : "div";
    const buttonAttrs = requestCount ? `type="button" data-review-date="${key}" aria-label="\u67e5\u770b ${formatDate(key)} \u7684\u7533\u8acb"` : "";

    cells.push(`
      <${element} ${buttonAttrs} class="month-day request-review-day ${needsReview ? "needs-review" : ""} ${requestCount ? "has-request" : "no-request"}">
        <span class="day-number">${day}</span>
        ${needsReview ? `<span class="review-dot" aria-hidden="true"></span>` : ""}
        ${tag ? `<span class="review-day-tag">${tag}${requestCount > 1 ? ` ${requestCount}` : ""}</span>` : ""}
      </${element}>
    `);
  }

  target.innerHTML = `
    <div class="admin-request-calendar">
      <div class="month-head compact">
        <button class="small-round" id="adminRequestPrevMonth" type="button" aria-label="\u4e0a\u4e00\u500b\u6708">&#8249;</button>
        <div>
          <p class="card-kicker">review month</p>
          <h3>${year} \u5e74 ${month + 1} \u6708</h3>
        </div>
        <button class="small-round" id="adminRequestNextMonth" type="button" aria-label="\u4e0b\u4e00\u500b\u6708">&#8250;</button>
      </div>
      <p class="admin-review-summary">${reviewCount ? `\u6709 ${reviewCount} \u7b46\u9084\u5728\u7b49\u4f60\u5be9\u6838\u3002` : "\u76ee\u524d\u6c92\u6709\u5f85\u5be9\u6838\u7684\u7533\u8acb\u3002"}</p>
      <div class="week-row" aria-hidden="true">
        <span>\u65e5</span><span>\u4e00</span><span>\u4e8c</span><span>\u4e09</span><span>\u56db</span><span>\u4e94</span><span>\u516d</span>
      </div>
      <div class="month-grid admin-review-grid">${cells.join("")}</div>
    </div>
  `;
}

function renderAdmin() {
  if (session?.role !== "admin") return;
  ensureActivityTypes();
  try {
    renderAdminRequestCalendar();
  } catch (error) {
    console.warn("renderAdminRequestCalendar failed", error);
    const target = $("#adminRequests");
    if (target) target.innerHTML = `<p class="empty-state">\u5be9\u6838\u6708\u66c6\u8f09\u5165\u5931\u6557\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u518d\u8a66\u3002</p>`;
  }
  try {
    renderTypeEditor();
  } catch (error) {
    console.warn("renderTypeEditor failed", error);
    const target = $("#adminTypes");
    if (target) target.innerHTML = `<p class="empty-state">\u985e\u578b\u8f09\u5165\u5931\u6557\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u518d\u8a66\u3002</p>`;
  }
}

function ensureActivityTypes() {
  if (!Array.isArray(activityTypes) || !activityTypes.length) {
    activityTypes = structuredClone(defaultActivityTypes);
  }
  if (!Array.isArray(data.activityTypes) || !data.activityTypes.length) {
    data.activityTypes = activityTypes;
  }
  if (!activityTypes.some((type) => type.id === selectedActivityTypeId)) {
    selectedActivityTypeId = activityTypes[0]?.id || "";
  }
}
function saveActivityTypes() {
  data.activityTypes = activityTypes;
  saveData();
}

function renderTypeEditor() {
  const target = $("#adminTypes");
  if (!target) return;
  ensureActivityTypes();
  const selectedType = activityTypes.find((type) => type.id === selectedActivityTypeId);
  const isUsed = selectedType ? data.requests.some((request) => request.activityId === selectedType.id) : false;
  target.innerHTML = `
    <div class="type-toolbar">
      <button class="primary-button" type="button" data-add-type>\u65b0\u589e\u985e\u578b</button>
    </div>
    <div class="type-picker" aria-label="\u9078\u64c7\u8981\u7de8\u8f2f\u7684\u985e\u578b">
      ${activityTypes
        .map((type) => `<button type="button" class="${type.id === selectedActivityTypeId ? "active" : ""}" data-select-type="${type.id}">${escapeHtml(type.short || type.label)}</button>`)
        .join("")}
    </div>
    ${
      selectedType
        ? `
          <article class="request-card type-editor-card">
            <div class="request-topline">
              <div>
                <p class="card-kicker">editing type</p>
                <h3>${escapeHtml(selectedType.label)}</h3>
              </div>
              <button class="danger-button" type="button" data-delete-type="${selectedType.id}" ${isUsed ? "disabled" : ""}>\u522a\u9664</button>
            </div>
            <label>
              \u985e\u578b\u540d\u7a31
              <input data-type-draft-field="label" value="${escapeHtml(selectedType.label)}" />
            </label>
            <label>
              \u6708\u66c6\u77ed\u6a19\u7c64
              <input data-type-draft-field="short" value="${escapeHtml(selectedType.short || "")}" />
            </label>
            <label>
              \u9810\u7d04\u6642\u6bb5\u6578
              <input data-type-draft-field="blocks" type="number" min="1" value="${selectedType.blocks || 1}" />
            </label>
            <label>
              OK \u516c\u7248\u56de\u8986
              <textarea data-type-draft-field="template">${escapeHtml(selectedType.template || "")}</textarea>
            </label>
            ${isUsed ? `<p class="hint">\u5df2\u6709\u7533\u8acb\u4f7f\u7528\u4e2d\uff0c\u66ab\u6642\u4e0d\u80fd\u522a\u9664\u3002</p>` : ""}
            <button class="primary-button" type="button" data-confirm-type="${selectedType.id}">\u78ba\u8a8d\u66f4\u65b0\u985e\u578b</button>
            <p class="sync-notice ${typeEditorNotice ? "" : "hidden"}">${typeEditorNotice || "\u5df2\u66f4\u65b0\u985e\u578b"}</p>
          </article>
        `
        : `<p class="empty-state">\u76ee\u524d\u6c92\u6709\u985e\u578b\u3002</p>`
    }
  `;
}

function commitTypeEditor(typeId) {
  const type = activityTypes.find((item) => item.id === typeId);
  if (!type) return;
  document.querySelectorAll("[data-type-draft-field]").forEach((field) => {
    type[field.dataset.typeDraftField] = field.dataset.typeDraftField === "blocks" ? Number(field.value) || 1 : field.value;
  });
  selectedActivityTypeId = type.id;
  typeEditorNotice = "已更新類型";
  saveActivityTypes();
  renderTypeEditor();
}

function dateKeyToLocalDate(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function dateKeysBetween(startKey, endKey) {
  const start = dateKeyToLocalDate(startKey);
  const end = dateKeyToLocalDate(endKey);
  if (!start || !end) return [];
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const keys = [];
  const cursor = new Date(from);
  while (cursor <= to && keys.length < 62) {
    keys.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function readAdminCalendarDraft(dateKey) {
  const savedDay = getCalendarDay(dateKey);
  const status = document.querySelector(`[data-admin-calendar-status="${dateKey}"]`)?.value || savedDay.status;
  return {
    status,
    memo: document.querySelector(`[data-admin-calendar-memo="${dateKey}"]`)?.value || "",
    publicStatus: document.querySelector(`[data-admin-calendar-public-status="${dateKey}"]`)?.value || "",
    availableTimes: isAdminBookableStatus(status) ? selectedAdminTimes(dateKey) : [],
  };
}

function writeCalendarDayFromDraft(dateKey, draft) {
  const day = getCalendarDay(dateKey);
  day.status = draft.status || day.status;
  day.memo = draft.memo;
  day.publicStatus = draft.publicStatus;
  day.availableTimes = isAdminBookableStatus(day.status) ? [...draft.availableTimes] : [];
  day.publicEvent = "";
  day.publicRequest = "";
  day.publicRemaining = "";
}

function applyAdminCalendarRange(dateKey) {
  const start = document.querySelector(`[data-admin-range-start="${dateKey}"]`)?.value || dateKey;
  const end = document.querySelector(`[data-admin-range-end="${dateKey}"]`)?.value || dateKey;
  const keys = dateKeysBetween(start, end);
  if (!keys.length) return;
  const draft = readAdminCalendarDraft(dateKey);
  keys.forEach((key) => writeCalendarDayFromDraft(key, draft));
  adminCalendarNotice = `\u5df2\u5957\u7528\u5230 ${keys.length} \u5929`;
  saveData();
  renderMonth();
}
function renderAdminDayEditor(selector = "#dayDetail") {
  const target = $(selector);
  if (!target) return;
  if (!selectedAdminDateKey) {
    target.innerHTML = `<section class="admin-day-editor"><p class="empty-state">點月曆日期就可以編輯公開日曆。</p></section>`;
    return;
  }
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const selectedDate = selectedAdminDateKey ? new Date(`${selectedAdminDateKey}T00:00:00`) : null;
  if (!selectedAdminDateKey || selectedDate?.getFullYear() !== year || selectedDate?.getMonth() !== month) {
    selectedAdminDateKey = toDateKey(new Date(year, month, 1));
  }
  const selectedDay = getCalendarDay(selectedAdminDateKey);
  const selectedRequests = summarizeRequests(selectedAdminDateKey);
  const selectedAvailableTimes = availableTimesForDate(selectedAdminDateKey, selectedDay);
  const publicPreview = dayPublicDetail(selectedDay, selectedAdminDateKey, selectedRequests, selectedAvailableTimes);

  target.innerHTML = `
      <section class="admin-day-editor">
        <div>
          <p class="card-kicker">selected date</p>
          <h3>${formatDate(selectedAdminDateKey)}</h3>
        </div>
        <label>
          朋友看到的狀態
          <select data-admin-calendar-status="${selectedAdminDateKey}">
            ${adminStatusOptions.map((value) => `<option value="${value}" ${selectedDay.status === value ? "selected" : ""}>${statusText[value]}</option>`).join("")}
          </select>
        </label>
        <label>
          狀態顯示文字
          <input data-admin-calendar-public-status="${selectedAdminDateKey}" value="${escapeHtml(selectedDay.publicStatus || statusText[selectedDay.status] || "暫不開放")}" />
        </label>
        <label>
          我的行程安排
          <textarea data-admin-calendar-memo="${selectedAdminDateKey}" placeholder="只有你管理時用，也可作為朋友看到的備註。">${escapeHtml(selectedDay.memo || "")}</textarea>
        </label>
        ${renderAdminTimePicker(selectedAdminDateKey, selectedDay)}
        <p class="hint ${isAdminBookableStatus(selectedDay.status) ? "" : "hidden"}" data-time-picker-hint="${selectedAdminDateKey}">點選時段膠囊即可開放或取消；也可以用快捷鍵一次選上午、下午、晚上或全天。</p>
        <section class="front-preview" data-admin-front-preview="${selectedAdminDateKey}"></section>
        <section class="bulk-apply-panel">
          <div>
            <p class="card-kicker">apply range</p>
            <h3>\u5957\u7528\u5230\u591a\u5929</h3>
            <p class="hint">\u6703\u628a\u4e0a\u9762\u76ee\u524d\u586b\u597d\u7684\u72c0\u614b\u3001\u986f\u793a\u6587\u5b57\u3001\u884c\u7a0b\u5b89\u6392\u548c\u53ef\u7d04\u6642\u6bb5\u4e00\u8d77\u5957\u7528\u3002</p>
          </div>
          <div class="bulk-apply-fields">
            <label>\u5f9e<input type="date" data-admin-range-start="${selectedAdminDateKey}" value="${selectedAdminDateKey}" /></label>
            <label>\u5230<input type="date" data-admin-range-end="${selectedAdminDateKey}" value="${selectedAdminDateKey}" /></label>
          </div>
          <button class="secondary-button" type="button" data-apply-admin-calendar-range="${selectedAdminDateKey}">\u5957\u7528\u9019\u6bb5\u65e5\u671f</button>
        </section>
        <button class="primary-button" type="button" data-confirm-admin-calendar="${selectedAdminDateKey}">確認更新公開日曆</button>
        <p class="sync-notice ${adminCalendarNotice ? "" : "hidden"}" id="adminCalendarSaved">${adminCalendarNotice || "已更新公開日曆"}</p>
      </section>
  `;
  syncAdminTimePickerVisibility(selectedAdminDateKey);
}

function commitAdminCalendarEdits(dateKey) {
  writeCalendarDayFromDraft(dateKey, readAdminCalendarDraft(dateKey));
  adminCalendarNotice = "\u5df2\u66f4\u65b0\u516c\u958b\u65e5\u66c6";
  saveData();
  renderMonth();
}

function renderRequests(requests, readonly) {
  if (!requests.length) return `<p class="empty-state">目前還沒有邀約。</p>`;
  return requests
    .map((request) => {
      const activity = getActivity(request.activityId);
      const visibleStatus = readonly ? (request.syncedAt ? request.sentStatus || request.status : request.sentStatus || "pending") : request.status;
      const sentReply = request.syncedAt ? request.sentReply || request.replyDraft : "";
      return `
        <article class="request-card">
          <div class="request-topline">
            <div>
              <p class="card-kicker">${activity?.label || "邀約"}</p>
              <h3>${escapeHtml(request.name)} · ${requestStatusText[visibleStatus] || visibleStatus}</h3>
            </div>
            <span>${formatDate(request.createdAt)}</span>
          </div>
          <p class="request-meta">${formatDate(request.date)} · ${formatRequestTimeRange(request)}</p>
          <p>${escapeHtml(request.message || "沒有留言")}</p>
          ${readonly ? `
            ${sentReply ? `<div class="friend-update"><p class="card-kicker">reply</p><p>${escapeHtml(sentReply)}</p></div>` : ""}
          ` : `
            <div class="button-row">
              <button type="button" data-approve="${request.id}">OK</button>
              <button type="button" data-status="${request.id}" data-next-status="change">需討論</button>
              <button type="button" data-status="${request.id}" data-next-status="declined">NO</button>
            </div>
            <label>
              可編輯回覆
              <textarea data-reply="${request.id}">${escapeHtml(request.replyDraft || "")}</textarea>
            </label>
            <button class="primary-button" type="button" data-confirm-request="${request.id}">確認更新給朋友</button>
            ${recentlySyncedRequestId === request.id ? `<p class="sync-notice">更新完成，已同步發給朋友嚕</p>` : ""}
          `}
        </article>
      `;
    })
    .join("");
}

function renderAdminRequestDialog() {
  if (!selectedAdminRequestDateKey) return;
  const requests = getRequestsForDate(selectedAdminRequestDateKey);
  $("#adminRequestDialogTitle").textContent = `${formatDate(selectedAdminRequestDateKey)} 的申請`;
  $("#adminRequestDialogNotice").classList.toggle("hidden", !adminReviewNotice);
  $("#adminRequestDialogNotice").textContent = adminReviewNotice || "已更新狀態";
  $("#adminRequestDialogBody").innerHTML = requests.length
    ? requests
        .map((request) => {
          const activity = getActivity(request.activityId);
          const replyChoices = [
            { status: "approved", label: "OK 公版", text: buildReply(request) },
            { status: "change", label: "待討論公版", text: discussionReply(request) },
            { status: "declined", label: "婉拒公版", text: declinedReply(request) },
          ];
          return `
            <article class="request-card review-card ${request.status}">
              <div class="request-topline">
                <div>
                  <p class="card-kicker">${activity?.label || "邀約"}</p>
                  <h3>${escapeHtml(request.name)} · ${requestStatusText[request.status] || request.status}</h3>
                </div>
                <div class="review-card-tools">
                  <span>${formatRequestTimeRange(request)}</span>
                  <button class="delete-request-button" type="button" data-delete-request="${request.id}" aria-label="刪除 ${escapeHtml(request.name)} 的申請">刪除</button>
                </div>
              </div>
              <p class="request-meta">${formatDate(request.date)} · ${formatRequestTimeRange(request)}</p>
              <p>${escapeHtml(request.message || "沒有留言")}</p>
              <div class="button-row review-actions">
                <button class="review-action ok ${request.status === "approved" ? "active" : ""}" type="button" data-review-action="approved" data-review-id="${request.id}">OK</button>
                <button class="review-action discuss ${request.status === "change" ? "active" : ""}" type="button" data-review-action="change" data-review-id="${request.id}">需討論</button>
                <button class="review-action no ${request.status === "declined" ? "active" : ""}" type="button" data-review-action="declined" data-review-id="${request.id}">NO</button>
              </div>
              <div class="reply-template-list">
                ${replyChoices
                  .filter((choice) => request.status === choice.status)
                  .map((choice) => `
                    <div class="copy-box reply-template active">
                      <p class="card-kicker">${choice.label}</p>
                      <textarea data-review-reply="${request.id}">${escapeHtml(request.replyDraft || choice.text)}</textarea>
                      <button type="button" data-copy-reply="${request.id}">複製</button>
                    </div>
                  `).join("")}
              </div>
              ${recentlySyncedRequestId === request.id ? `<p class="sync-notice">已更新狀態</p>` : ""}
            </article>
          `;
        })
        .join("")
    : `<p class="empty-state">這天沒有申請。</p>`;
}

function openAdminRequestDialog(dateKey) {
  selectedAdminRequestDateKey = dateKey;
  adminReviewNotice = "";
  renderAdminRequestDialog();
  $("#adminRequestDialog").showModal();
}

function syncApprovedRequestToCalendar(request) {
  const day = getCalendarDay(request.date);
  day.requestSyncIds = [...new Set([...(day.requestSyncIds || []), request.id])];
  syncDateRequestsToCalendar(request.date, request);
}

function calendarLooksLinkedToRequest(day, request) {
  const name = request.name || "朋友";
  return (
    (day.requestSyncIds || []).includes(request.id) ||
    day.publicRequest === "目前收到來自公主的邀請。" ||
    day.publicEvent === activityPublicEvent(request) ||
    day.publicStatus === "今天已有約" ||
    (name && (day.memo || "").includes(name))
  );
}

function clearRequestGeneratedCalendarText(day, request) {
  const name = request.name || "";
  day.publicEvent = "";
  day.publicRequest = "";
  day.publicRemaining = "";
  day.requestSyncIds = [];
  if (name && (day.memo || "").includes(name)) day.memo = "";
}

function syncDateRequestsToCalendar(dateKey, fallbackRequest = null) {
  const day = getCalendarDay(dateKey);
  const blockingRequests = data.requests.filter((request) => request.date === dateKey && request.status !== "declined" && request.status !== "done");

  if (blockingRequests.length) {
    blockingRequests.forEach((request) => {
      day.requestSyncIds = [...new Set([...(day.requestSyncIds || []), request.id])];
    });
    const reservedSlots = blockingRequests.flatMap((request) => reservedTimesForRequest(request));
    const reservedTimes = new Set(reservedSlots);
    const baseTimes = sortTimes([...(day.availableTimes || []), ...reservedSlots]);
    const remainingTimes = baseTimes.filter((time) => !reservedTimes.has(time));
    const approved = blockingRequests.filter((request) => request.status === "approved");
    const mainRequest = approved[0] || blockingRequests[0];

    day.availableTimes = remainingTimes;
    day.status = remainingTimes.length ? "partial" : "booked";
    if (approved.length) {
      day.publicStatus = "\u4eca\u5929\u5df2\u6709\u7d04";
      day.publicEvent = activityPublicEvent(mainRequest);
      day.publicRequest = "\u76ee\u524d\u6536\u5230\u4f86\u81ea\u516c\u4e3b\u7684\u9080\u8acb\u3002";
    } else {
      day.publicStatus = remainingTimes.length ? day.publicStatus || "\u8acb\u7d04\u6211" : "\u5be9\u6838\u9810\u7d04\u4e2d";
      day.publicEvent = "";
      day.publicRequest = "";
    }
    day.publicRemaining = remainingTimes.length
      ? `${remainingTimes.slice(0, 8).join("\u3001")}${remainingTimes.length > 8 ? `\uff0c\u9084\u6709 ${remainingTimes.length - 8} \u500b\u6642\u6bb5` : ""}`
      : "no";
    return;
  }

  if (!fallbackRequest || !calendarLooksLinkedToRequest(day, fallbackRequest)) return;

  const restoredTimes = sortTimes([...(day.availableTimes || []), ...reservedTimesForRequest(fallbackRequest)]);
  day.availableTimes = restoredTimes;
  day.status = restoredTimes.length ? "partial" : "closed";
  clearRequestGeneratedCalendarText(day, fallbackRequest);
}
function releaseApprovedRequestFromCalendar(request) {
  syncDateRequestsToCalendar(request.date, request);
}

function repairBlockingRequestCalendarSync() {
  const dates = [...new Set(data.requests
    .filter((request) => request.date && request.status !== "declined" && request.status !== "done")
    .map((request) => request.date))];
  if (!dates.length) return false;
  dates.forEach((dateKey) => syncDateRequestsToCalendar(dateKey));
  return true;
}
async function deleteInviteRequest(requestId) {
  const request = data.requests.find((item) => item.id === requestId);
  if (!request) return;
  const ok = window.confirm(`確定要刪除 ${request.name || "朋友"} 的申請嗎？刪除後不能復原。`);
  if (!ok) return;

  if (supabaseClient && isUuid(request.id)) {
    const { error } = await supabaseClient.from("invite_requests").delete().eq("id", request.id);
    if (error) {
      adminReviewNotice = `刪除失敗：${error.message}`;
      renderAdminRequestDialog();
      return;
    }
  }

  data.requests = data.requests.filter((item) => item.id !== request.id);
  syncDateRequestsToCalendar(request.date, request);
  recentlySyncedRequestId = "";
  adminReviewNotice = "\u5df2\u522a\u9664\u7533\u8acb";
  saveData();
  render();
  if ($("#adminRequestDialog")?.open) renderAdminRequestDialog();
}
function updateRequestReview(requestId, nextStatus) {
  const request = data.requests.find((item) => item.id === requestId);
  if (!request) return;
  if (nextStatus === "approved" && requestConflicts(request.date, request.time, inferredRequestEndTime(request), request.id, ["approved"])) {
    adminReviewNotice = "這個時段已經有 OK 的申請了";
    renderAdminRequestDialog();
    return;
  }

  request.status = nextStatus;
  request.updatedAt = new Date().toISOString().slice(0, 10);
  request.syncedAt = new Date().toISOString();
  request.sentStatus = nextStatus;
  request.replyDraft =
    nextStatus === "approved"
      ? buildReply(request)
      : nextStatus === "change"
        ? discussionReply(request)
        : declinedReply();
  request.sentReply = request.replyDraft;
  request.sentAdminNote = "";
  recentlySyncedRequestId = request.id;
  adminReviewNotice = "已更新狀態";

  syncDateRequestsToCalendar(request.date, request);

  saveData();
  render();
  renderAdminRequestDialog();
}

function openBookingDialog(dateKey) {
  const day = getCalendarDay(dateKey);
  if (!isDayBookable(day, dateKey)) return;
  $("#bookingDate").value = dateKey;
  $("#bookingDateText").textContent = formatDate(dateKey);
  $("#bookingName").value = "";
  const availableTimes = availableTimesForDate(dateKey);
  $("#bookingStartTime").innerHTML = buildTimeOptions(availableTimes);
  updateBookingEndOptions();
  $("#bookingActivity").innerHTML = activityTypes.map((type) => `<option value="${type.id}">${type.label}</option>`).join("");
  $("#bookingMessage").value = "";
  $("#bookingError").textContent = "";
  $("#bookingDialog").showModal();
}

$("#closeLoginButton").addEventListener("click", () => $("#loginDialog").close());
$("#closeBookingButton").addEventListener("click", () => $("#bookingDialog").close());
$("#closeAdminRequestButton").addEventListener("click", () => $("#adminRequestDialog").close());

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) {
    $("#loginError").textContent = "目前還沒有載入雲端登入功能，請重新整理後再試一次。";
    return;
  }
  const email = $("#loginUser").value.trim();
  const password = $("#loginPassword").value;
  const { data: authData, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error || !authData.user) {
    console.warn("Supabase login error", error);
    $("#loginError").textContent = error?.message ? `登入失敗：${error.message}` : "管理者帳密不正確。";
    return;
  }
  const { data: isAdmin, error: adminError } = await supabaseClient.rpc("is_admin");
  if (adminError || !isAdmin) {
    await supabaseClient.auth.signOut();
    $("#loginError").textContent = "這個 email 還不是管理者。";
    return;
  }
  session = { role: "admin", id: authData.user.id, name: "我的後台", email: authData.user.email };
  $("#loginError").textContent = "";
  $("#loginDialog").close();
  await loadCloudData();
  showView("public");
});

async function logoutAdmin() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  session = null;
  $("#loginDialog").close();
  await loadCloudData();
  showView("public");
}

$("#logoutButton").addEventListener("click", logoutAdmin);
$("#topLogoutButton").addEventListener("click", logoutAdmin);

$("#goMemberButton").addEventListener("click", () => {
  if ($("#loginDialog").open) $("#loginDialog").close();
  showView("public");
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

$("#prevMonth").addEventListener("click", () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  selectedAdminDateKey = "";
  renderMonth();
});

$("#nextMonth").addEventListener("click", () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  selectedAdminDateKey = "";
  renderMonth();
});

$("#monthGrid").addEventListener("click", (event) => {
  const dayButton = event.target.closest("[data-book-date]");
  if (dayButton) {
    openBookingDialog(dayButton.dataset.bookDate);
    return;
  }
  const detailButton = event.target.closest("[data-view-date]");
  if (detailButton) {
    selectedDateKey = detailButton.dataset.viewDate;
    renderMonth();
  }
});

$("#bookingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (bookingSubmitting) return;
  bookingSubmitting = true;
  const submitButton = event.submitter || $("#bookingForm")?.querySelector('button[type="submit"]');
  const submitText = submitButton?.textContent || "\u9001\u51fa\u9810\u7d04\u7533\u8acb";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "\u9001\u51fa\u4e2d...";
  }

  try {
    const date = $("#bookingDate").value;
    const startTime = $("#bookingStartTime").value;
    const endTime = $("#bookingEndTime").value;
    const requestedTimes = timesInBookingRange(startTime, endTime);
    if (!requestedTimes.length) {
      $("#bookingError").textContent = "\u8acb\u9078\u64c7\u4e00\u6bb5\u53ef\u4ee5\u9810\u7d04\u7684\u6642\u9593\u3002";
      return;
    }
    const availableSet = new Set(availableTimesForDate(date));
    if (requestedTimes.some((time) => !availableSet.has(time))) {
      $("#bookingError").textContent = "\u9019\u6bb5\u6642\u9593\u5df2\u7d93\u4e0d\u80fd\u9810\u7d04\u4e86\uff0c\u8acb\u63db\u4e00\u6bb5\u6642\u9593\u3002";
      return;
    }
    if (requestConflicts(date, startTime, endTime)) {
      $("#bookingError").textContent = "\u9019\u6bb5\u6642\u9593\u6b63\u5728\u5be9\u6838\u6216\u5df2\u7d93\u88ab\u7d04\u8d70\u4e86\uff0c\u8acb\u63db\u4e00\u6bb5\u6642\u9593\u3002";
      return;
    }
    const nextRequest = {
      id: createId("req"),
      name: $("#bookingName").value.trim() || "\u670b\u53cb",
      activityId: $("#bookingActivity").value,
      date,
      time: startTime,
      endTime,
      leaveAt: "",
      message: $("#bookingMessage").value.trim(),
      status: "pending",
      sentStatus: "pending",
      adminNote: "",
      replyDraft: "",
      sentReply: "",
      sentAdminNote: "",
      syncedAt: "",
      createdAt: new Date().toISOString().slice(0, 10),
      updatedAt: "",
    };
    let savedRequest = nextRequest;
    if (supabaseClient) {
      const payload = requestToRow(nextRequest);
      delete payload.id;
      const { data: functionData, error: functionError } = await supabaseClient.functions.invoke("create-invite-request", { body: payload });
      if (functionError) {
        $("#bookingError").textContent = "\u9001\u51fa\u5931\u6557\uff0c\u8acb\u7b49\u4e00\u4e0b\u518d\u8a66\u4e00\u6b21\u3002";
        console.warn(functionError);
        return;
      } else if (functionData?.request) {
        savedRequest = requestFromRow(functionData.request);
      }
    }
    if (!data.requests.some((request) => request.id === savedRequest.id)) data.requests.unshift(savedRequest);
    const day = getCalendarDay(date);
    if (day.status === "open") day.status = "partial";
    day.availableTimes = availableTimesForDate(date, day);
    saveData({ cloud: false });
    $("#bookingDialog").close();
    render();
  } finally {
    bookingSubmitting = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitText;
    }
  }
});
document.body.addEventListener("click", async (event) => {
  const target = event.target;
  const startEditButton = target.closest("[data-start-edit]");
  if (startEditButton) {
    editingGroup = startEditButton.dataset.startEdit;
    render();
    return;
  }
  const howToggle = target.closest("#howEyeToggle");
  if (howToggle) {
    data.settings.howVisible = data.settings.howVisible === false;
    saveData();
    renderHowItWorks();
    return;
  }
  const editAction = target.closest("[data-edit-action]");
  if (editAction) {
    applyEditAction(editAction.dataset.editGroup, editAction.dataset.editAction);
    return;
  }
  if (target.closest("#adminRequestPrevMonth")) {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    render();
  }
  if (target.closest("#adminRequestNextMonth")) {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    render();
  }
  const reviewDayButton = target.closest("[data-review-date]");
  if (reviewDayButton) {
    openAdminRequestDialog(reviewDayButton.dataset.reviewDate);
    return;
  }
  const reviewActionButton = target.closest("[data-review-action]");
  if (reviewActionButton) {
    updateRequestReview(reviewActionButton.dataset.reviewId, reviewActionButton.dataset.reviewAction);
    return;
  }
  const deleteRequestButton = target.closest("[data-delete-request]");
  if (deleteRequestButton) {
    await deleteInviteRequest(deleteRequestButton.dataset.deleteRequest);
    return;
  }
  const copyReplyButton = target.closest("[data-copy-reply]");
  if (copyReplyButton) {
    const request = data.requests.find((item) => item.id === copyReplyButton.dataset.copyReply);
    const textarea = document.querySelector(`[data-review-reply="${copyReplyButton.dataset.copyReply}"]`);
    const text = textarea?.value || request?.replyDraft || "";
    if (request) {
      request.replyDraft = text;
      request.sentReply = text;
      saveData();
    }
    navigator.clipboard?.writeText(text);
    adminReviewNotice = "已複製文字";
    renderAdminRequestDialog();
    return;
  }
  const copyButton = target.closest("[data-copy-text]");
  if (copyButton) {
    const text = copyButton.dataset.copyText;
    navigator.clipboard?.writeText(text);
    adminReviewNotice = "已複製文字";
    renderAdminRequestDialog();
    return;
  }
  const detailBookingButton = target.closest("[data-book-from-detail]");
  if (detailBookingButton) {
    openBookingDialog(detailBookingButton.dataset.bookFromDetail);
    return;
  }
  if (target.closest("[data-add-type]")) {
    const nextType = {
      id: createId("type"),
      label: "新邀約類型",
      short: "邀約",
      blocks: 1,
      template: "{name}，我收到你的邀約了。",
    };
    activityTypes.push(nextType);
    selectedActivityTypeId = nextType.id;
    typeEditorNotice = "";
    saveActivityTypes();
    renderTypeEditor();
    return;
  }
  const selectTypeButton = target.closest("[data-select-type]");
  if (selectTypeButton) {
    selectedActivityTypeId = selectTypeButton.dataset.selectType;
    typeEditorNotice = "";
    renderTypeEditor();
    return;
  }
  const confirmTypeButton = target.closest("[data-confirm-type]");
  if (confirmTypeButton) {
    commitTypeEditor(confirmTypeButton.dataset.confirmType);
    return;
  }
  const deleteTypeButton = target.closest("[data-delete-type]");
  if (deleteTypeButton) {
    const id = deleteTypeButton.dataset.deleteType;
    if (data.requests.some((request) => request.activityId === id)) return;
    activityTypes = activityTypes.filter((type) => type.id !== id);
    selectedActivityTypeId = activityTypes[0]?.id || "";
    typeEditorNotice = "";
    saveActivityTypes();
    renderTypeEditor();
    return;
  }
  const timePresetButton = target.closest("[data-time-preset]");
  if (timePresetButton) {
    setAdminTimeSelection(timePresetButton.dataset.timeDate, presetTimes(timePresetButton.dataset.timePreset));
    renderAdminDraftPreview(timePresetButton.dataset.timeDate);
    return;
  }
  const timeRangeButton = target.closest("[data-time-range-add]");
  if (timeRangeButton) {
    const dateKey = timeRangeButton.dataset.timeRangeAdd;
    const start = document.querySelector(`[data-time-range-start="${dateKey}"]`)?.value;
    const end = document.querySelector(`[data-time-range-end="${dateKey}"]`)?.value;
    setAdminTimeSelection(dateKey, [...selectedAdminTimes(dateKey), ...timesInRange(start, end)]);
    renderAdminDraftPreview(dateKey);
    return;
  }
  const timeChipButton = target.closest("[data-time-chip]");
  if (timeChipButton) {
    const dateKey = timeChipButton.dataset.timeChip;
    const time = timeChipButton.dataset.timeValue;
    const selected = new Set(selectedAdminTimes(dateKey));
    if (selected.has(time)) selected.delete(time);
    else selected.add(time);
    setAdminTimeSelection(dateKey, [...selected]);
    renderAdminDraftPreview(dateKey);
    return;
  }

  const applyAdminRangeButton = target.closest("[data-apply-admin-calendar-range]");
  if (applyAdminRangeButton) {
    applyAdminCalendarRange(applyAdminRangeButton.dataset.applyAdminCalendarRange);
    return;
  }
  const confirmAdminCalendarButton = target.closest("[data-confirm-admin-calendar]");
  if (confirmAdminCalendarButton) {
    commitAdminCalendarEdits(confirmAdminCalendarButton.dataset.confirmAdminCalendar);
    return;
  }
  const adminDayButton = target.closest("[data-admin-date-key]");
  if (adminDayButton) {
    selectedAdminDateKey = adminDayButton.dataset.adminDateKey;
    adminCalendarNotice = "";
    getCalendarDay(selectedAdminDateKey);
    saveData();
    renderMonth();
  }
  if (target.matches("[data-approve]")) {
    const request = data.requests.find((item) => item.id === target.dataset.approve);
    if (!request || requestConflicts(request.date, request.time, inferredRequestEndTime(request), request.id, ["approved"])) return;
    request.status = "approved";
    request.replyDraft = request.replyDraft || buildReply(request);
    request.updatedAt = new Date().toISOString().slice(0, 10);
    request.syncedAt = new Date().toISOString();
    request.sentStatus = request.status;
    request.sentReply = request.replyDraft || "";
    request.sentAdminNote = request.adminNote || "";
    recentlySyncedRequestId = request.id;
    syncApprovedRequestToCalendar(request);
    saveData();
    render();
  }
  if (target.matches("[data-status]")) {
    const request = data.requests.find((item) => item.id === target.dataset.status);
    if (!request) return;
    recentlySyncedRequestId = "";
    request.status = target.dataset.nextStatus;
    request.updatedAt = new Date().toISOString().slice(0, 10);
    syncDateRequestsToCalendar(request.date, request);
    saveData();
    render();
  }
  if (target.matches("[data-confirm-request]")) {
    const request = data.requests.find((item) => item.id === target.dataset.confirmRequest);
    if (!request) return;
    request.updatedAt = new Date().toISOString().slice(0, 10);
    request.syncedAt = new Date().toISOString();
    request.sentStatus = request.status;
    request.sentReply = request.replyDraft || "";
    request.sentAdminNote = request.adminNote || "";
    recentlySyncedRequestId = request.id;
    if (request.status === "approved") syncApprovedRequestToCalendar(request);
    saveData();
    render();
  }
});

document.body.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches("[data-reply]")) {
    const request = data.requests.find((item) => item.id === target.dataset.reply);
    if (request) request.replyDraft = target.value;
    recentlySyncedRequestId = "";
    target.closest(".request-card")?.querySelector(".sync-notice")?.remove();
  }
  if (target.matches("[data-admin-calendar-public-status]")) {
    adminCalendarNotice = "";
    $("#adminCalendarSaved")?.classList.add("hidden");
    renderAdminDraftPreview(target.dataset.adminCalendarPublicStatus);
  }
  if (target.matches("[data-admin-calendar-memo]")) {
    adminCalendarNotice = "";
    $("#adminCalendarSaved")?.classList.add("hidden");
    renderAdminDraftPreview(target.dataset.adminCalendarMemo);
  }
  if (target.matches("[data-admin-calendar-times]")) {
    adminCalendarNotice = "";
    $("#adminCalendarSaved")?.classList.add("hidden");
  }
  if (target.matches("[data-type-draft-field]")) {
    typeEditorNotice = "";
    target.closest(".type-editor-card")?.querySelector(".sync-notice")?.classList.add("hidden");
  }
  saveData();
});

document.body.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-review-reply]")) {
    const request = data.requests.find((item) => item.id === target.dataset.reviewReply);
    if (request) {
      request.replyDraft = target.value;
      request.sentReply = target.value;
      saveData();
    }
    return;
  }
  if (target.matches("#bookingStartTime")) {
    updateBookingEndOptions();
    return;
  }
  if (target.matches("[data-admin-calendar-status]")) {
    adminCalendarNotice = "";
    $("#adminCalendarSaved")?.classList.add("hidden");
    const statusInput = document.querySelector(`[data-admin-calendar-public-status="${target.dataset.adminCalendarStatus}"]`);
    if (statusInput) statusInput.value = statusText[target.value] || target.value;
    syncAdminTimePickerVisibility(target.dataset.adminCalendarStatus);
    renderAdminDraftPreview(target.dataset.adminCalendarStatus);
  }
});

document.querySelectorAll(".admin-menu button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".admin-menu button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.querySelectorAll(".admin-tab").forEach((tab) => tab.classList.add("hidden"));
    $(`#admin${button.dataset.adminTab[0].toUpperCase()}${button.dataset.adminTab.slice(1)}Tab`)?.classList.remove("hidden");
    if (button.dataset.adminTab === "requests") renderAdminRequestCalendar();
    if (button.dataset.adminTab === "types") renderTypeEditor();
  });
});

async function initApp() {
  await hydrateSession();
  await loadCloudData();
  render();
}

initApp();












