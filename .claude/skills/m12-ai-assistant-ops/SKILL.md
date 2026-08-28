---
name: m12-ai-assistant-ops
description: Vận hành trợ lý AI "Trợ lý Lịch Tải" của m12-lich-tai — đổi/thêm model LLM, sửa system prompt, đồng bộ kho kiến thức (knowledge base). Kích hoạt khi user nói "sửa trợ lý AI", "đổi model", "trợ lý trả lời sai", "cập nhật kiến thức cho bot", "dạy trợ lý", hoặc chỉnh sửa functions/api/assistant.ts.
---

# Vận hành trợ lý AI (Trợ lý Lịch Tải)

Đọc [m12-conventions](../m12-conventions/SKILL.md) mục 2 (không bịa số liệu) — áp dụng trực tiếp cho
system prompt của trợ lý này.

## Kiến trúc model chain

File chính: [functions/api/assistant.ts](../../../functions/api/assistant.ts) (~900 dòng).

**Thứ tự ưu tiên gọi model** (rơi xuống dòng dưới khi dòng trên rate-limit/lỗi):

1. **Cloudflare Workers AI** (chính — miễn phí, không quota Gemini, không bị chặn IP như Groq):
   - `CF_70B = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"` — phân tích/kế hoạch (nặng, cần chất lượng).
   - `CF_8B = "@cf/meta/llama-3.1-8b-instruct-fp8"` — chat nhanh, hỗ trợ tool-calling.
   - `CF_MORE[]` — dự phòng tiếp: qwen 14b, mistral 7b, llama-3-8b.
2. **Google Gemini** (phụ, khi CF rate-limit): `MODELS[]` = `gemini-2.5-flash-lite` →
   `gemini-2.0-flash-lite` → `gemini-2.5-flash` → `gemini-2.0-flash`.
3. Các pool khác (`OR_MODELS` openrouter, `MISTRAL_MODELS`, `GH_MODELS` github, `NVIDIA_MODELS`,
   `COHERE_MODELS`) chỉ kích hoạt nếu có API key tương ứng trong env — coi là **dự phòng mở rộng**, không
   phải đường chính.

### Thêm/đổi model

- Thêm model vào đúng mảng ưu tiên (`CF_MORE`, `MODELS`, hoặc pool tương ứng) — KHÔNG đổi thứ tự
  `CF_70B`/`CF_8B` làm model chính trừ khi được yêu cầu rõ (đây là lựa chọn đã cân nhắc: free + không bị
  chặn IP Cloudflare, xem comment trong `wrangler.toml` phần `[ai]`).
- Nếu thêm provider mới (pool mới), cần: (1) thêm mảng model, (2) đọc API key từ `env`, (3) thêm vào
  `pool.push({name, run: () => callOAChat(...)})` trong logic chọn pool. Đây là thay đổi có rủi ro (thêm
  secret mới) — hỏi user xác nhận trước khi thêm provider ngoài.

## System prompts — sửa đúng phần, không viết đè cả khối

4 prompt chính trong `assistant.ts`, mỗi cái ~3KB, đã tinh chỉnh kỹ:

| Prompt | Vai trò |
|---|---|
| `CORE` | Persona "Trợ lý Lịch Tải" — xưng hô Sếp/em, dạ/vâng, **chỉ dùng số liệu thật, không bịa** |
| `SYSTEM` | Hành vi mở rộng: hiểu menu 3 cấp, tối ưu tuyến, tầng xe (đội nền → NCC cố định → dự phòng GHN → thuê ngoài hotline), one-shot learning từ góp ý |
| `ANALYZE` | Persona phân tích dữ liệu: diễn giải sản lượng/TLLD, tìm nguyên nhân, đề xuất hành động |
| `EVENTPLAN` | Báo cáo lập kế hoạch sự kiện 6 phần (forecast, đội xe, tăng cường, Plan A/B/C, KPI, rủi ro) |

Khi sửa hành vi trợ lý: xác định đúng prompt liên quan (đừng sửa `CORE` khi vấn đề chỉ ở `EVENTPLAN`),
sửa tối thiểu cần thiết, giữ nguyên văn phong Sếp/em đã thống nhất — đây là yêu cầu nghiệp vụ, không phải
tuỳ chọn kỹ thuật.

## Knowledge base (kho kiến thức bổ sung)

```
Google Sheet "Kiến thức bổ sung M12" (KNOWLEDGE_SHEET_ID trong config.ts)
    ↓ functions/api/knowsync.ts   — chạy tự động ~1 lần/ngày (fire-and-forget từ App.tsx useEffect)
    ↓ distill bằng AI (gộp trùng, gán chuyên mục)
Cloudflare KV
    ↓ functions/api/knowledge.ts  — CRUD (GET/POST add/update/delete)
    ↓ src/lib/knowledge.ts        — client: getKnowledge/addKnowledge/teachKnowledge
    ↓ inject vào system prompt lúc chat (assistant.ts)
```

- **Dạy trực tiếp qua chat**: Sếp gõ `"dạy: <nội dung>"` / `"nhớ: ..."` / `"ghi nhớ: ..."` trong BẤT KỲ
  mục chat nào → `isTeach()` nhận diện (regex `TEACH_RE` trong `knowledge.ts`) → `teachKnowledge()` gọi
  AI chắt lọc (`organizeKnowledge`, mode `"organize"` trong `assistant.ts`) → tự gộp nếu trùng ý cũ, tự
  gán chuyên mục, lưu KV. Kiến thức dùng **chung cho mọi mục chat**, không tách theo view.
- Nếu cần thêm cách "dạy" mới (ví dụ dạy qua 1 form riêng thay vì gõ chat) → tái dùng `teachKnowledge()`,
  không viết lại logic distill/merge.
- Sync sheet → KV chỉ chạy ~1 lần/ngày do server tự giới hạn — nếu cần đồng bộ ngay lập tức để test,
  gọi trực tiếp `GET /api/knowsync` (không cần đợi App tự trigger).

## Khi trợ lý trả lời sai/bịa số

1. Kiểm tra xem câu hỏi có cần dữ liệu function-calling chưa wire (`ASKTOOLS` prompt đã soạn nhưng theo
   phân tích codebase **chưa nối đầy đủ** tới `/api/route`, `/api/tlld`, `/api/dashdata`) — nếu đúng vậy,
   đây là hạn chế đã biết, không phải bug mới, cân nhắc báo user thay vì tự ý wire vội.
2. Nếu là lỗi prompt (hiểu sai ý, xưng hô sai) → sửa prompt tương ứng, KHÔNG sửa bằng cách thêm hard-code
   if/else trong code xử lý reply — giữ triết lý "để AI diễn giải, code chỉ tính số".
3. Test lại bằng `npm run dev`, hỏi lại đúng câu đã sai, xác nhận cả model chính (CF) lẫn fallback
   (Gemini) đều trả lời đúng nếu sửa prompt dùng chung.
