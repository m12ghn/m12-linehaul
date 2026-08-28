/* Điểm bắt đầu xin lại quyền Google — chuyển hướng sang màn đồng ý của Google với ĐẦY ĐỦ scope
   cần (Sheets đọc + Drive đọc, để đọc được file My Map qua Drive API thay cho link công khai
   đang bị Google chặn 403). Đăng nhập lại 1 lần bằng scope MỚI này sẽ ghi đè refresh_token cũ
   trong KV (qua oauth-callback.ts) — vẫn dùng được Sheets như cũ, cộng thêm quyền đọc Drive. */
const REDIRECT_URI = "https://m12-lich-tai.pages.dev/api/oauth-callback";
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

export const onRequestGet = async ({ env }: any): Promise<Response> => {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return new Response("Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID", { status: 500 });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent", // BẮT BUỘC hiện lại màn đồng ý -> đảm bảo nhận refresh_token MỚI với scope mới
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
};
