/* ============================================================
   OAuth callback (1 lần) — nhận "code" Google trả về sau khi
   thovdt@ghn.vn bấm "Cho phép", đổi lấy access_token + refresh_token,
   lưu refresh_token vào KV (QA_KV, key "oauth:google_refresh_token")
   để sheet-v4.ts dùng lâu dài mà không cần đăng nhập lại.
   ============================================================ */
const REDIRECT_URI = "https://m12-lich-tai.pages.dev/api/oauth-callback";

function html(body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center">${body}</body>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export const onRequestGet = async ({ request, env }: any): Promise<Response> => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) return html(`<h2>Lỗi: ${err}</h2>`);
  if (!code) return html(`<h2>Thiếu code</h2>`);

  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return html(`<h2>Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID/SECRET</h2>`);

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data: any = await res.json();
  if (!res.ok || !data.refresh_token) {
    return html(`<h2>Lỗi đổi token</h2><pre>${JSON.stringify(data, null, 2)}</pre>`);
  }

  await env.QA_KV.put("oauth:google_refresh_token", data.refresh_token);
  if (data.access_token) {
    await env.QA_KV.put(
      "oauth:google_access_token",
      JSON.stringify({ token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 - 60000 })
    );
  }

  return html(`<h2>✅ Đã kết nối xong với Google Sheets</h2><p>Đóng tab này lại là được, không cần làm gì thêm.</p>`);
};
