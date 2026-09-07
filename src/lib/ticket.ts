/* ============================================================
   TICKET VẬN TẢI — đọc log tin nhắn Telegram (workbook riêng, xem TICKET_SHEET_ID
   ở config.ts), lọc ra các tin mang tính "yêu cầu GSVT xử lý" thành ticket, gộp
   theo luồng reply/mã TTC để xem đủ ngữ cảnh dù các tin không nằm chung 1 dòng
   (đúng yêu cầu Sếp 07/09/2026: "tin nhắn liên kết với nhau nhưng không nằm
   chung 1 row").

   NGUỒN: Sheet do 1 job userbot Telegram RIÊNG (không thuộc repo này) ghi liên
   tục vào tab đầu (gid=0) — dashboard CHỈ ĐỌC, không đụng tới job ghi log đó
   (đã trao đổi với Sếp, không gộp code job đó vào đây vì khác kiến trúc: job
   cần chạy nền dài hạn, còn repo này là frontend serverless trên Vercel).

   PHẠM VI (chốt qua AskUserQuestion 07/09/2026):
   - Ticket = tin thuộc 1 trong TICKET_CATEGORIES bên dưới (10/18 nhãn của cột
     có sẵn "Phân loại (auto)" — cột này do 1 bot phân loại KHÁC gắn sẵn trên
     Sheet, không phải AI ở đây tự suy đoán lại). Các nhãn còn lại (chat chung,
     media không có nội dung text, xác nhận ngắn kiểu "Ok"/"Oke anh", thông báo
     tự động full tải, bot báo lỗi tự động, TC-Đã duyệt/Từ chối tự động) KHÔNG
     tính là ticket riêng — gộp làm "phản hồi" của ticket gốc (xem 2 cơ chế gộp
     luồng bên dưới).
   - Group: gộp cả 30 group Telegram, không lọc riêng nhóm NCC.
   - MVP: chỉ hiển thị + lọc/tìm kiếm — CHƯA có cột trạng thái Mở/Đã xử lý (đợt
     sau nếu Sếp cần, tự suy luận từ có/không có phản hồi sẽ không chính xác
     100% nên cố ý để dành).

   CÁCH GỘP LUỒNG (2 cơ chế, ĐỘC LẬP với nhau):
   1) reply-chain thật của Telegram: cột "Loại liên kết"="reply" + "ID/Thông
      tin tin gốc" = Message ID của tin cha (cùng Group ID) — bám đúng cấu
      trúc log export ra.
   2) mã "TTC-xxxx" trong nội dung: 3 nhãn TC-Đăng ký mới/Đã duyệt/Từ chối
      (auto) do bot m12_bot_van_tai gửi RỜI RẠC (không reply nhau, xác nhận
      qua khảo sát dữ liệu mẫu) nhưng cùng nhắc 1 mã ticket tăng cường -> khớp
      theo mã thay vì theo reply-chain.

   ⚠ Dữ liệu Sheet có ~2 dòng lỗi/trắng (dòng đầu bị lệch cột, 2 dòng cuối rỗng
   hoàn toàn) — parseRows() tự bỏ qua bằng cách yêu cầu "Thời gian" parse được
   thành ngày hợp lệ, không cần xử lý riêng.
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { fetchWithTimeout } from "./fetchTimeout";
import { TICKET_SHEET_ID, TICKET_GID, sheetCsvSources } from "../config";

/** 10 nhãn "Phân loại (auto)" tính là ticket (yêu cầu GSVT làm gì đó) — chốt qua AskUserQuestion. */
export const TICKET_CATEGORIES = [
  "Gắn/Lên App",
  "Yêu cầu kết thúc app",
  "TC - Đăng ký mới (auto)",
  "Yêu cầu bỏ điểm",
  "Lỗi app / cần xử lý tay app",
  "Yêu cầu hủy tải",
  "Hỏi vị trí/tiến độ tải",
  "Báo tình trạng hàng (ít/hết)",
  "Yêu cầu gán tài xế/xe",
  "Yêu cầu xin/hỏi TC (thủ công)",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/** 2 nhãn trạng thái tự động của luồng TC — khớp vào ticket "Đăng ký mới" cùng mã TTC-xxxx. */
const TC_STATUS_CATEGORIES = ["TC - Đã duyệt (auto)", "TC - Từ chối (auto)"];

export interface TicketReply {
  time: Date;
  sender: string;
  content: string;
  category: string;
  viaTicketCode?: boolean; // true = khớp qua mã TTC- (không phải reply-chain Telegram thật)
}

export interface Ticket {
  id: string; // groupId + "#" + messageId (thêm hậu tố ":n" nếu trùng — xem buildTickets())
  time: Date;
  groupId: string;
  groupName: string;
  sender: string;
  content: string;
  category: TicketCategory;
  ticketCode: string | null; // TTC-xxxx nếu nội dung có nhắc
  replies: TicketReply[];
  lastActivity: Date; // = time nếu chưa có phản hồi nào, dùng để sắp "mới hoạt động nhất"
  // 07/09/2026 (khuya) — yêu cầu "TC-Đăng ký mới có phản hồi Duyệt/Từ chối thì đóng":
  // true nếu ticket "TC - Đăng ký mới (auto)" đã có phản hồi TC-Đã duyệt/Từ chối (auto)
  // khớp qua mã TTC-xxxx (xem bước 2 gộp luồng bên dưới) — KHÔNG lưu Supabase, tự suy ra
  // mỗi lần tải vì dữ liệu gốc (Sheet) đã có đủ, tránh phải đồng bộ 2 nơi.
  autoClosed: boolean;
  autoCloseReason?: "approved" | "rejected";
}

interface RawRow {
  time: Date;
  groupId: string;
  groupName: string;
  sender: string;
  messageId: string;
  content: string;
  category: string;
  linkType: string;
  linkInfo: string;
}

async function fetchFrom(sources: string[], signal?: AbortSignal): Promise<string | null> {
  for (const url of sources) {
    try {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetchWithTimeout(url + sep + "_=" + Date.now(), { cache: "no-store", signal });
      if (res.ok) {
        const t = await res.text();
        if (t.trim().length > 5) return t;
      }
    } catch {
      /* nguồn kế tiếp */
    }
  }
  return null;
}

const s = (v: string | undefined): string => (v || "").trim();

/** "YYYY-M-D H:MM:SS" (export CSV Google có khi bỏ số 0 đầu giờ/phút/ngày/tháng). */
function parseTime(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(d.getTime()) ? null : d;
}

const TTC_RE = /TTC-\d+/;

function parseRows(text: string): RawRow[] {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0];
  const col = {
    time: findCol(header, ["thoi gian"]),
    groupId: findCol(header, ["group id"]),
    groupName: findCol(header, ["ten nhom"]),
    sender: findCol(header, ["nguoi gui"]),
    messageId: findCol(header, ["message id"]),
    content: findCol(header, ["noi dung"]),
    category: findCol(header, ["phan loai"]),
    linkType: findCol(header, ["loai lien ket"]),
    linkInfo: findCol(header, ["thong tin tin goc"]),
  };
  const g = (r: string[], i: number) => (i >= 0 ? s(r[i]) : "");
  const out: RawRow[] = [];
  for (const r of rows.slice(1)) {
    const time = parseTime(g(r, col.time));
    if (!time) continue; // bỏ dòng lỗi/trắng
    out.push({
      time,
      groupId: g(r, col.groupId),
      groupName: g(r, col.groupName),
      sender: g(r, col.sender),
      messageId: g(r, col.messageId),
      content: g(r, col.content),
      category: g(r, col.category),
      linkType: g(r, col.linkType),
      linkInfo: g(r, col.linkInfo),
    });
  }
  return out;
}

/** Group ID dạng "-100.../123" (topic diễn đàn) -> nhóm gốc trước dấu "/" để tra tên nhóm. */
function baseGroupId(gid: string): string {
  const i = gid.indexOf("/");
  return i >= 0 ? gid.slice(0, i) : gid;
}

/** Mỗi Group ID gốc chỉ có 1 tên (Sheet để thưa dòng, không lặp lại mỗi hàng) -> dò tên đầu tiên gặp. */
function buildGroupNames(rows: RawRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    if (!r.groupName) continue;
    const base = baseGroupId(r.groupId);
    if (!m.has(base)) m.set(base, r.groupName);
  }
  return m;
}

function isTicketCategory(cat: string): cat is TicketCategory {
  return (TICKET_CATEGORIES as readonly string[]).includes(cat);
}

export interface TicketData {
  tickets: Ticket[];
  groupNames: string[]; // danh sách tên nhóm distinct, đã sắp xếp — cho dropdown lọc
  lastSync: number;
}

function buildTickets(rows: RawRow[]): { tickets: Ticket[]; groupNames: Map<string, string> } {
  const groupNames = buildGroupNames(rows);
  const nameOf = (gid: string) => groupNames.get(baseGroupId(gid)) || "(chưa rõ tên nhóm)";

  const byMsgKey = new Map<string, Ticket>(); // groupId#messageId GỐC (chưa chống trùng) của CHÍNH ticket -> dùng để khớp reply-chain
  const byTicketCode = new Map<string, Ticket>(); // TTC-xxxx -> ticket "Đăng ký mới" tương ứng
  const tickets: Ticket[] = [];
  // 07/09/2026 (khuya): phát hiện qua báo lỗi thật trên production — Sếp lọc theo 1 loại
  // yêu cầu nhưng thẻ hiện ra lại thuộc loại KHÁC. Nghi vấn hàng đầu: log Sheet có dòng
  // trùng "Group ID#Message ID" (job userbot ghi lại/ghi đè), khiến 2 ticket KHÁC NHAU
  // (khác loại) dùng chung 1 khoá `id` -> React (key trùng) và bảng ticket_status/ticket_notes
  // (khoá chính = id) đều có thể lẫn lộn dữ liệu giữa 2 ticket đó. Chống bằng cách ép `id`
  // của MỖI ticket luôn duy nhất (thêm hậu tố ":2", ":3"... nếu trùng) — `byMsgKey` (dùng để
  // khớp reply-chain thật, theo ĐÚNG "Group ID#Message ID" gốc) không đổi, vẫn lấy ticket
  // ĐẦU TIÊN gặp cho mỗi khoá gốc, giữ nguyên hành vi khớp phản hồi như trước.
  const usedIds = new Set<string>();

  for (const r of rows) {
    if (!isTicketCategory(r.category)) continue;
    const code = r.content.match(TTC_RE)?.[0] || null;
    const rawKey = r.groupId + "#" + r.messageId;
    let id = rawKey;
    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(rawKey + ":" + n)) n++;
      id = rawKey + ":" + n;
      console.warn(`[ticket.ts] Trùng ID ticket "${rawKey}" trong log Sheet (2 dòng khác nhau cùng Group ID + Message ID) — dùng "${id}" để tránh lẫn dữ liệu giữa 2 ticket.`);
    }
    usedIds.add(id);
    const t: Ticket = {
      id,
      time: r.time,
      groupId: r.groupId,
      groupName: nameOf(r.groupId),
      sender: r.sender,
      content: r.content,
      category: r.category as TicketCategory,
      ticketCode: code,
      replies: [],
      lastActivity: r.time,
      autoClosed: false,
    };
    tickets.push(t);
    if (!byMsgKey.has(rawKey)) byMsgKey.set(rawKey, t);
    if (r.category === "TC - Đăng ký mới (auto)" && code && !byTicketCode.has(code)) byTicketCode.set(code, t);
  }

  // 1) reply-chain thật: hàng reply thẳng vào 1 ticket (mà bản thân nó KHÔNG phải ticket khác) -> gộp làm phản hồi.
  for (const r of rows) {
    if (r.linkType !== "reply" || !r.linkInfo || isTicketCategory(r.category)) continue;
    const parent = byMsgKey.get(r.groupId + "#" + r.linkInfo);
    if (!parent) continue;
    parent.replies.push({ time: r.time, sender: r.sender, content: r.content, category: r.category });
    if (r.time > parent.lastActivity) parent.lastActivity = r.time;
  }

  // 2) mã TTC-xxxx: gắn tin "Đã duyệt"/"Từ chối" (auto) vào đúng ticket "Đăng ký mới" cùng mã.
  for (const r of rows) {
    if (!TC_STATUS_CATEGORIES.includes(r.category)) continue;
    const code = r.content.match(TTC_RE)?.[0];
    const parent = code ? byTicketCode.get(code) : undefined;
    if (!parent) continue;
    parent.replies.push({ time: r.time, sender: r.sender, content: r.content, category: r.category, viaTicketCode: true });
    if (r.time > parent.lastActivity) parent.lastActivity = r.time;
  }

  for (const t of tickets) t.replies.sort((a, b) => a.time.getTime() - b.time.getTime());

  // 07/09/2026 (khuya): ticket "TC - Đăng ký mới (auto)" đã có phản hồi TC-Đã duyệt/Từ chối
  // (auto) khớp qua mã TTC-xxxx (bước 2 ở trên) -> coi như đã có kết quả, không cần GSVT xử
  // lý tay nữa. Lấy phản hồi SỚM NHẤT trong 2 loại (replies đã sort theo thời gian tăng dần ở
  // trên) — trường hợp có cả 2 (hiếm, có thể do đổi quyết định) thì tính theo cái đến trước.
  for (const t of tickets) {
    if (t.category !== "TC - Đăng ký mới (auto)") continue;
    const hit = t.replies.find((r) => r.viaTicketCode && (r.category === "TC - Đã duyệt (auto)" || r.category === "TC - Từ chối (auto)"));
    if (hit) {
      t.autoClosed = true;
      t.autoCloseReason = hit.category === "TC - Đã duyệt (auto)" ? "approved" : "rejected";
    }
  }

  tickets.sort((a, b) => b.time.getTime() - a.time.getTime()); // mới nhất trước
  return { tickets, groupNames };
}

const TICKET_TTL = 60000; // đúng REFRESH_MS chung — job userbot ghi liên tục, không cần realtime sát hơn
let cache: { at: number; data: TicketData } | null = null;
let inflight: Promise<TicketData> | null = null;

export async function loadTickets(signal?: AbortSignal, force = false): Promise<TicketData> {
  if (!force) {
    if (cache && Date.now() - cache.at < TICKET_TTL) return cache.data;
    if (inflight) return inflight;
  }
  const run = loadTicketsUncached(signal).then((data) => {
    cache = { at: Date.now(), data };
    return data;
  });
  inflight = run;
  try {
    return await run;
  } finally {
    inflight = null;
  }
}

async function loadTicketsUncached(signal?: AbortSignal): Promise<TicketData> {
  const txt = await fetchFrom(sheetCsvSources(TICKET_SHEET_ID, TICKET_GID), signal);
  const rows = txt ? parseRows(txt) : [];
  const { tickets, groupNames } = buildTickets(rows);
  return { tickets, groupNames: [...new Set(groupNames.values())].sort((a, b) => a.localeCompare(b, "vi")), lastSync: Date.now() };
}
