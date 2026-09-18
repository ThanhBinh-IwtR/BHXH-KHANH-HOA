import type { Page } from '@playwright/test';

const GROUNDED = {
  scopeStatus: 'grounded',
  shortAnswer: 'Người sử dụng lao động đóng 17% vào quỹ hưu trí và tử tuất. Đây là tỷ lệ đóng hằng tháng được nêu tại khoản 3 Điều 12.',
  analysis: [
    {
      claim: 'Tỷ lệ đóng của người sử dụng lao động là 17%.',
      citations: [
        { sourceId: 'nd-158-2025:dieu-12:khoan-3:2025-demo-v1', label: '158/2025/NĐ-CP · Điều 12 · Khoản 3' },
      ],
    },
    {
      claim: 'Khoản đóng này được xác định cho quỹ hưu trí và tử tuất theo nội dung điều khoản được dẫn.',
      citations: [
        { sourceId: 'nd-158-2025:dieu-12:khoan-3:2025-demo-v1', label: '158/2025/NĐ-CP · Điều 12 · Khoản 3' },
      ],
    },
    {
      claim: 'Văn bản nêu tần suất đóng là hằng tháng, nên khi áp dụng cần đối chiếu đúng kỳ đóng tương ứng.',
      citations: [
        { sourceId: 'nd-158-2025:dieu-12:khoan-3:2025-demo-v1', label: '158/2025/NĐ-CP · Điều 12 · Khoản 3' },
      ],
    },
  ],
  aiSupplement: 'Quỹ hưu trí và tử tuất là một trong các quỹ thành phần của BHXH.',
  missingInformation: [],
  followUpQuestion: null,
  sources: [
    {
      sourceId: 'nd-158-2025:dieu-12:khoan-3:2025-demo-v1',
      label: '158/2025/NĐ-CP · Điều 12 · Khoản 3',
      documentNumber: '158/2025/NĐ-CP',
      pageFrom: 8,
      pageTo: 8,
    },
  ],
};

const PARTIAL = {
  ...GROUNDED,
  scopeStatus: 'partial',
  shortAnswer: 'Nguồn hiện có chỉ xác nhận một phần nội dung câu hỏi.',
  aiSupplement: null,
  missingInformation: ['Phần điều kiện còn lại cần đối chiếu với văn bản chính thức'],
  followUpQuestion: 'Bạn có thể bổ sung dữ kiện để đối chiếu phần còn lại với văn bản chính thức không?',
};

const CLARIFY = {
  scopeStatus: 'needs_clarification',
  shortAnswer: 'Cần thêm thông tin để trả lời chính xác.',
  analysis: [],
  aiSupplement: null,
  missingInformation: ['Nhóm đối tượng tham gia cụ thể'],
  followUpQuestion: 'Bạn thuộc nhóm tham gia BHXH bắt buộc hay tự nguyện?',
  sources: [],
};

const OUT_OF_SCOPE = {
  scopeStatus: 'out_of_scope',
  shortAnswer: 'Câu hỏi nằm ngoài phạm vi bốn nghị định trong bộ dữ liệu demo.',
  analysis: [],
  aiSupplement: null,
  missingInformation: ['Nội dung cần tra cứu ngoài bốn nghị định trong bộ dữ liệu demo'],
  followUpQuestion: 'Bạn có thể chuyển sang cổng thông tin chính thức của BHXH để tra cứu nội dung này không?',
  sources: [],
};

const SOURCE_DETAIL = {
  sourceId: 'nd-158-2025:dieu-12:khoan-3:2025-demo-v1',
  documentNumber: '158/2025/NĐ-CP',
  breadcrumb: '158/2025/NĐ-CP > Chương II > Điều 12 > Khoản 3',
  articleTitle: 'Mức đóng và phương thức đóng bảo hiểm xã hội bắt buộc',
  bodyText: 'Người sử dụng lao động hằng tháng đóng với tỷ lệ 17% vào quỹ hưu trí và tử tuất.',
  pageFrom: 8,
  pageTo: 8,
  pdfUrl: '/corpus/158_2025_ND-CP_25062025-signed.pdf#page=8',
};

/** Deterministically route every backend call so E2E needs no live providers. */
export async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON() as { message?: string };
    const message = (body?.message ?? '').toLowerCase();
    if (message.includes('cancel request')) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return route.fulfill({ json: GROUNDED });
    }
    if (message.includes('timeout')) {
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'provider_unavailable',
            message: 'Dịch vụ tạm thời không khả dụng. Vui lòng thử lại.',
          },
        },
      });
    }
    if (message.includes('ratelimit')) {
      return route.fulfill({
        status: 429,
        json: {
          error: {
            code: 'rate_limited',
            message: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.',
          },
        },
      });
    }
    if (message.includes('ngoài phạm vi')) {
      return route.fulfill({ json: OUT_OF_SCOPE });
    }
    if (message.includes('làm rõ')) {
      return route.fulfill({ json: CLARIFY });
    }
    if (message.includes('một phần')) {
      return route.fulfill({ json: PARTIAL });
    }
    return route.fulfill({ json: GROUNDED });
  });

  await page.route('**/api/sources/**', async (route) => {
    return route.fulfill({ json: SOURCE_DETAIL });
  });

  await page.route('**/api/documents', async (route) => {
    return route.fulfill({ json: { documents: [] } });
  });
}
