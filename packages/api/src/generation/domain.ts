// Prepared offline from the source register in Demo-Agent/docs/ticket-classification-poc.
// The categories and literal matching rules are PoC decisions, not a vendor SOP.
export const domainContext = `General customer support ticket classification only.
Input: CSV columns id, subject, description, all strings. Keep every input row and its original fields.
Policy v1: subject and description must both be strings; otherwise category=manual_review, manual_review=true, reason=invalid_input, matched_categories=[].
Join subject and description with one space, trim and lowercase (do not remove Vietnamese accents).
If the joined text is empty: category=manual_review, manual_review=true, reason=missing_content, matched_categories=[].
Find categories by literal substring matching ANY of their terms anywhere in the joined lowercase text:
billing: invoice, refund, thanh toán, hoàn tiền
delivery: shipment, tracking, giao hàng, vận chuyển
account: login, password, đăng nhập, mật khẩu
Collect each matched category exactly once, in the above order.
Exactly one matched category: category=that category, manual_review=false, reason=single_match.
Zero matches: category=manual_review, manual_review=true, reason=no_match.
More than one category: category=manual_review, manual_review=true, reason=ambiguous.
Return fields category, manual_review (boolean), reason, matched_categories (array of category names), alongside original fields.
This is a literal rule policy, not semantic intent recognition or probabilistic confidence. Negation still matches literals.
Do not infer synonyms, priority, routing, escalation, replies, or resolution. Never drop tickets. No runtime LLM calls.`;

export const requirements = {
  en: 'Create an executable workflow that reads the uploaded support ticket CSV, classifies every ticket using policy v1, preserves the original fields, and returns classification results. Mark missing, unknown, and ambiguous tickets for manual review. Do not route or reply.',
  vi: 'Tạo workflow thực thi được để đọc CSV ticket hỗ trợ đã tải lên, phân loại từng ticket theo policy v1, giữ nguyên các trường ban đầu và trả kết quả phân loại. Đánh dấu ticket thiếu thông tin, không khớp hoặc mơ hồ để kiểm tra thủ công. Không định tuyến hay trả lời khách hàng.',
} as const;
