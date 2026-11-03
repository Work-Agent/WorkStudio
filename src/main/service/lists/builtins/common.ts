import type { ListActionSpec, ListFieldSpec } from '../../../../shared/lists';

export const DOC_FIELDS: ListFieldSpec[] = [
  { key: 'title', type: 'text' },
  { key: 'subtitle', type: 'text' },
  { key: 'time', type: 'time' },
];

export const OPEN_ACTION: ListActionSpec = {
  id: 'open',
  label: '打开',
  scope: 'workspace',
  action: 'list.action',
};
