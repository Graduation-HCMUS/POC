import type { WorkflowDraft } from '@packages/contracts';

import { edge } from './helpdesk.ts';

// Written before model generation. Never imported by the online generator.
export const classificationCases = [
  {
    id: '1',
    subject: 'INVOICE question',
    description: 'Please help',
    category: 'billing',
    manual_review: false,
    reason: 'single_match',
    matched_categories: ['billing'],
  },
  {
    id: '2',
    subject: 'Parcel',
    description: 'Where is my shipment?',
    category: 'delivery',
    manual_review: false,
    reason: 'single_match',
    matched_categories: ['delivery'],
  },
  {
    id: '3',
    subject: 'Access',
    description: 'Reset my password',
    category: 'account',
    manual_review: false,
    reason: 'single_match',
    matched_categories: ['account'],
  },
  {
    id: '4',
    subject: '',
    description: '   ',
    category: 'manual_review',
    manual_review: true,
    reason: 'missing_content',
    matched_categories: [],
  },
  {
    id: '5',
    subject: 'Opening hours',
    description: 'When are you open?',
    category: 'manual_review',
    manual_review: true,
    reason: 'no_match',
    matched_categories: [],
  },
  {
    id: '6',
    subject: 'Refund',
    description: 'My shipment is late',
    category: 'manual_review',
    manual_review: true,
    reason: 'ambiguous',
    matched_categories: ['billing', 'delivery'],
  },
  {
    id: '7',
    subject: 'Cần hỗ trợ',
    description: 'Tôi muốn hoàn tiền',
    category: 'billing',
    manual_review: false,
    reason: 'single_match',
    matched_categories: ['billing'],
  },
  {
    id: '8',
    subject: 'Tài khoản',
    description: 'Tôi quên mật khẩu đăng nhập',
    category: 'account',
    manual_review: false,
    reason: 'single_match',
    matched_categories: ['account'],
  },
  {
    id: '9',
    subject: 'Not a refund',
    description: 'Just checking',
    category: 'billing',
    manual_review: false,
    reason: 'single_match',
    matched_categories: ['billing'],
  },
  {
    id: '10',
    subject: 'Tracking and shipment',
    description: 'Theo dõi giao hàng',
    category: 'delivery',
    manual_review: false,
    reason: 'single_match',
    matched_categories: ['delivery'],
  },
];

export const referenceWorkflow: WorkflowDraft = {
  name: 'Reference ticket classification policy v1',
  nodes: [
    {
      id: 'trigger',
      type: 'trigger',
      name: 'Ticket CSV',
      config: {},
      position: { x: 0, y: 0 },
    },
    {
      id: 'read',
      type: 'file',
      name: 'Read uploaded CSV',
      config: { operation: 'read', sourceKey: 'input' },
      position: { x: 220, y: 0 },
    },
    {
      id: 'parse',
      type: 'file',
      name: 'Parse ticket rows',
      config: { operation: 'parse', format: 'csv' },
      position: { x: 440, y: 0 },
    },
    {
      id: 'classify',
      type: 'custom',
      name: 'Apply policy v1',
      position: { x: 660, y: 0 },
      config: {
        code: `return items.map((item) => {
  const { subject, description } = item.json;
  let reason;
  const matched = [];
  if (typeof subject !== 'string' || typeof description !== 'string') {
    reason = 'invalid_input';
  } else {
    const text = (subject + ' ' + description).trim().toLowerCase();
    const terms = {
      billing: ['invoice', 'refund', 'thanh toán', 'hoàn tiền'],
      delivery: ['shipment', 'tracking', 'giao hàng', 'vận chuyển'],
      account: ['login', 'password', 'đăng nhập', 'mật khẩu']
    };
    for (const [category, words] of Object.entries(terms)) {
      if (words.some((word) => text.includes(word))) matched.push(category);
    }
    if (!text) reason = 'missing_content';
    else if (matched.length === 0) reason = 'no_match';
    else if (matched.length > 1) reason = 'ambiguous';
    else reason = 'single_match';
  }
  const review = reason !== 'single_match';
  return { ...item, json: { ...item.json,
    category: review ? 'manual_review' : matched[0],
    manual_review: review, reason, matched_categories: matched
  } };
});`,
      },
    },
    {
      id: 'output',
      type: 'output',
      name: 'Classification results',
      config: { outputName: 'classification' },
      position: { x: 880, y: 0 },
    },
  ],
  edges: [
    edge('trigger', 'read'),
    edge('read', 'parse'),
    edge('parse', 'classify'),
    edge('classify', 'output'),
  ],
};
