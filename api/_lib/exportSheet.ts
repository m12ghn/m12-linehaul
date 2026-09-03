/* ============================================================
   XUẤT DỮ LIỆU RA GOOGLE SHEET — logic dùng chung cho:
     • api/export-sheet.ts        (bấm nút trên dashboard)
     • api/cron/export-sheets.ts  (lịch tự động)

   Sheet nay chỉ còn là ĐÍCH XUẤT. Dòng đầu mỗi tab luôn ghi cảnh báo "CHỈ ĐỂ XEM"
   để không ai nhập nhầm lên đó nữa.
   ============================================================ */
import { select } from "./supabase";

const enc = new TextEncoder();
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function b64url(b: Uint8Array<ArrayBuffer>): string {
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Token service account (luồng JWT-bearer y như functions/api/_gsheets.ts cũ). */
export async function sheetsToken(): Promise<string> {
  const raw = (globalThis as any).process?.env?.GSHEETS_SA_B64;
  if (!raw) throw new Error("not_configured");
  const sa = JSON.parse(atob(String(raw)));
  const iat = Math.floor(Date.now() / 1000);
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(enc.encode(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600,
  })));
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(head + "." + claims));
  const jwt = head + "." + claims + "." + b64url(new Uint8Array(sig));

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")
        + "&assertion=" + encodeURIComponent(jwt),
  });
  if (!r.ok) throw new Error("token_exchange_failed:" + r.status);
  return (await r.json() as any).access_token;
}

const HEADER = ["Tên tuyến", "Loại tuyến", "Tải trọng", "NCC", "BKS",
                "Tên kho", "Loại hình", "Tới điểm", "Rời điểm", "ID"];

/** Dựng lưới ô cho 1 vùng, hình dạng giống hệt tab Sheet cũ để người xem không lạ mắt. */
export async function buildGrid(region: string, byWhom: string): Promise<string[][]> {
  const rows = await select<any>("routes", {
    select: "code,category,load,ncc,bks,stops(seq,kho,loai_hinh,toi,roi,ext_id)",
    filter: { region_key: "eq." + region, active: "is.true" },
    order: "sort.asc,code.asc",
  });

  const stamp = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const values: string[][] = [
    [`⚠ BẢNG NÀY CHỈ ĐỂ XEM — nhập liệu trên dashboard M12. Xuất lúc ${stamp} bởi ${byWhom}`],
    HEADER,
  ];

  for (const r of rows) {
    const stops = (r.stops || []).slice().sort((a: any, z: any) => a.seq - z.seq);
    const head = [r.code, r.category || "", r.load || "", r.ncc || "",
                  // Tiền tố "_" giữ mẹo cũ: chặn Sheets tự định dạng biển số thành ngày/số.
                  r.bks ? "_" + r.bks : ""];
    if (!stops.length) { values.push([...head, "", "", "", "", ""]); continue; }
    for (const s of stops) {
      values.push([...head, s.kho || "", s.loai_hinh || "", s.toi || "", s.roi || "", s.ext_id || ""]);
    }
  }
  return values;
}

/** Xoá sạch tab rồi ghi lại -> Sheet luôn là ảnh chụp đúng của Postgres, không sót dòng cũ. */
export async function writeTab(sheetId: string, tab: string, values: string[][], token: string): Promise<void> {
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;

  const clr = await fetch(base + ":clear", { method: "POST", headers: { authorization: "Bearer " + token } });
  if (!clr.ok) throw new Error("clear_failed:" + clr.status + ":" + (await clr.text()).slice(0, 200));

  const put = await fetch(base + "?valueInputOption=RAW", {
    method: "PUT",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (!put.ok) throw new Error("write_failed:" + put.status + ":" + (await put.text()).slice(0, 200));
}

/** Xuất 1 vùng. Trả số dòng dữ liệu đã ghi (không tính 2 dòng tiêu đề). */
export async function exportRegion(
  region: string, sheetId: string, tab: string, byWhom: string, token?: string,
): Promise<number> {
  const t = token || await sheetsToken();
  const values = await buildGrid(region, byWhom);
  await writeTab(sheetId, tab, values, t);
  return values.length - 2;
}
