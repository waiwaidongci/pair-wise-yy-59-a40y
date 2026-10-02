// 文档版本化协作 / 批次发布资格的纯逻辑层
// 所有合并、版本递增、资格重算都在这里完成，store 只负责状态装配与持久化。

export type Classification = '内部' | '机密' | '严格机密';

export type Redaction = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
  privilege: string;
  status: 'draft' | 'confirmed';
};

export const REVIEW_CHECK_IDS = [
  'forbidden-terms',
  'page-number',
  'image-boundary',
  'metadata'
] as const;
export type ReviewCheckId = (typeof REVIEW_CHECK_IDS)[number];

export const REVIEW_CHECK_LABELS: Record<ReviewCheckId, string> = {
  'forbidden-terms': '全文禁词与姓名复核',
  'page-number': '页序与页码连续性',
  'image-boundary': '图像边界残片',
  metadata: '文档元数据清理'
};

export type ReviewConclusion = {
  checks: Record<ReviewCheckId, boolean>;
  approved: boolean;
  reviewer: string;
  reviewedAt: string | null;
  /** 复核结论所针对的内容版本；版本上调而结论未更新时即为过期 */
  reviewedVersion: number | null;
};

/** 参与三方合并的版本化字段集合 */
export type VersionedFields = {
  classification: Classification;
  review: ReviewConclusion;
  redactions: Redaction[];
};

/** 每个字段各自的修订版本，用于判断复核结论与字段是否过期 */
export type FieldVersions = {
  classification: number;
  review: Record<ReviewCheckId | 'approved', number>;
  redactions: Record<string, number>;
};

export type DocumentStatus = '去密中' | '待质检' | '待裁决' | '可发布';

export type VersionedDocument = {
  id: string;
  title: string;
  bundle: string;
  pages: number;
  owner: string;
  issue: string;
  size: string;
  updatedAt: string;
  fields: VersionedFields;
  version: number;
  fieldVersions: FieldVersions;
  pendingConflicts: PendingConflict[];
  /** 上一次提交后的可恢复快照与重试上下文 */
  recovery: MergeRecovery | null;
};

export type PendingConflict = {
  id: string;
  field: string;
  label: string;
  page: number | null;
  mine: SideValue;
  theirs: SideValue;
  /** 双方是否都保留了该区域（false 表示一方删除、一方编辑） */
  bothPresent: boolean;
};

export type SideValue = { present: boolean; text: string };

export type MergeRecovery = {
  /** 合并前文档快照，用于整体回滚恢复 */
  snapshotDoc: VersionedDocument;
  baseFields: VersionedFields;
  baseVersion: number;
  /** 后保存一侧提交时的完整字段，裁决时取“本方”值 */
  mineFields: VersionedFields;
  /** 先保存一侧落库的完整字段，裁决时取“对方”值 */
  theirsFields: VersionedFields;
  editor: string;
  reason: string | null;
  at: string;
};

export type MergeOutcome = {
  fields: VersionedFields;
  changedFields: string[];
  conflicts: PendingConflict[];
};

export const initialFieldVersions = (): FieldVersions => ({
  classification: 1,
  review: {
    'forbidden-terms': 1,
    'page-number': 1,
    'image-boundary': 1,
    metadata: 1,
    approved: 1
  },
  redactions: {}
});

export const initialReview = (overrides: Partial<ReviewConclusion> = {}): ReviewConclusion => ({
  checks: {
    'forbidden-terms': false,
    'page-number': false,
    'image-boundary': false,
    metadata: false
  },
  approved: false,
  reviewer: '',
  reviewedAt: null,
  reviewedVersion: null,
  ...overrides
});

export const cloneFields = (fields: VersionedFields): VersionedFields =>
  JSON.parse(JSON.stringify(fields)) as VersionedFields;

const canonical = (value: unknown): string => {
  const sort = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(sort)
      : input && typeof input === 'object'
        ? Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sort(v)]))
        : input;
  return JSON.stringify(sort(value));
};

export const sameValue = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

const conflictId = (docId: string, field: string) => `${docId}::${field}`;

/** 两个字段集合之间发生变化的字段 key */
export function diffFields(a: VersionedFields, b: VersionedFields): string[] {
  const changed: string[] = [];
  if (!sameValue(a.classification, b.classification)) changed.push('classification');
  for (const id of REVIEW_CHECK_IDS) {
    if (!sameValue(a.review.checks[id], b.review.checks[id])) changed.push(`review.check.${id}`);
  }
  if (!sameValue(a.review.approved, b.review.approved)) changed.push('review.approved');
  // reviewedVersion 由 store 在提交时按新版本盖章；客户端将其置空即表示“对当前内容重新复核”
  if (!sameValue(a.review.reviewedVersion, b.review.reviewedVersion)) changed.push('review.approved');
  const ids = new Set([...a.redactions.map((r) => r.id), ...b.redactions.map((r) => r.id)]);
  for (const id of [...ids].sort()) {
    const ra = a.redactions.find((r) => r.id === id);
    const rb = b.redactions.find((r) => r.id === id);
    if (!sameValue(ra ?? null, rb ?? null)) changed.push(`redaction.${id}`);
  }
  return changed;
}

export function fieldLabel(field: string): { label: string; page: number | null } {
  if (field === 'classification') return { label: '密级', page: null };
  if (field === 'review.approved') return { label: '复核结论（通过/退回）', page: null };
  for (const id of REVIEW_CHECK_IDS) {
    if (field === `review.check.${id}`) return { label: `复核项 · ${REVIEW_CHECK_LABELS[id]}`, page: null };
  }
  if (field.startsWith('redaction.')) return { label: `去密区域 ${field.slice('redaction.'.length)}`, page: null };
  return { label: field, page: null };
}

function redactionText(redaction: Redaction | undefined): SideValue {
  if (!redaction) return { present: false, text: '（已删除）' };
  return {
    present: true,
    text: `第${redaction.page}页 · ${redaction.reason} / ${redaction.privilege} · ${redaction.status === 'confirmed' ? '已确认' : '草稿'}`
  };
}

/** 区域冲突里补充页码，便于裁决面板展示 */
export function enrichConflictPages(doc: VersionedDocument): PendingConflict[] {
  return doc.pendingConflicts.map((conflict) => {
    if (!conflict.field.startsWith('redaction.')) return conflict;
    const id = conflict.field.slice('redaction.'.length);
    const redaction = doc.fields.redactions.find((item) => item.id === id);
    return { ...conflict, page: redaction?.page ?? null };
  });
}

/**
 * 三方合并：base 是两边共同的起点，theirs 是先保存一侧（已入库事实），mine 是后保存一侧。
 * - 只有一侧改过：直接采用改动方；
 * - 同一字段两侧都改且结果不同：字段冻结为先保存者的值并挂起 pendingConflicts，
 *   两份取值都保留等待裁决，绝不静默覆盖后保存者，也不回退已发布事实；
 * - 区域按区域 id 逐个合并，互不相关的区域改动可以同时进入结果。
 */
export function threeWayMerge(params: {
  docId: string;
  base: VersionedFields;
  mine: VersionedFields;
  theirs: VersionedFields;
}): MergeOutcome {
  const { docId } = params;
  const base = cloneFields(params.base);
  const mine = cloneFields(params.mine);
  const theirs = cloneFields(params.theirs);
  // 直接提交：共同基线就是当前已入库版本，无并发可言，本方字段即为合并结果
  if (sameValue(base, theirs)) {
    return { fields: mine, changedFields: diffFields(base, mine), conflicts: [] };
  }
  // 合并结果以先保存者为基础（对方的改动已生效，不回退），本方的非冲突改动向上叠加
  const merged = cloneFields(theirs);
  const changed: string[] = [];
  const conflicts: PendingConflict[] = [];

  const pushConflict = (field: string, mineValue: SideValue, theirsValue: SideValue, bothPresent: boolean) => {
    const { label, page } = fieldLabel(field);
    conflicts.push({ id: conflictId(docId, field), field, label, page, mine: mineValue, theirs: theirsValue, bothPresent });
  };

  // 密级
  const classChangedByMine = mine.classification !== base.classification;
  const classChangedByTheirs = theirs.classification !== base.classification;
  if (classChangedByMine || classChangedByTheirs) {
    if (mine.classification === theirs.classification) {
      merged.classification = mine.classification; // 双方改成同一个值，视为一致
      changed.push('classification');
    } else if (classChangedByMine && classChangedByTheirs) {
      merged.classification = theirs.classification; // 冻结为先保存者，挂起裁决
      changed.push('classification');
      pushConflict(
        'classification',
        { present: true, text: mine.classification },
        { present: true, text: theirs.classification },
        true
      );
    } else if (classChangedByMine) {
      merged.classification = mine.classification;
      changed.push('classification');
    }
  }

  // 复核结论：四个检查项 + 通过结论，各自按标量合并
  for (const id of REVIEW_CHECK_IDS) {
    const field = `review.check.${id}`;
    const baseVal = base.review.checks[id];
    const myVal = mine.review.checks[id];
    const theirVal = theirs.review.checks[id];
    if (myVal === baseVal && theirVal === baseVal) continue;
    if (myVal !== baseVal && theirVal !== baseVal && myVal !== theirVal) {
      merged.review.checks[id] = theirVal; // 冻结为先保存者，挂起裁决
      changed.push(field);
      pushConflict(field, { present: true, text: myVal ? '已通过' : '未通过' }, { present: true, text: theirVal ? '已通过' : '未通过' }, true);
    } else if (myVal !== baseVal && theirVal === baseVal) {
      merged.review.checks[id] = myVal;
      changed.push(field);
    } else {
      changed.push(field); // 先保存者的值已在 merged 中
    }
  }

  const approvedField = 'review.approved';
  const baseApproved = base.review.approved;
  const myApproved = mine.review.approved;
  const theirApproved = theirs.review.approved;
  if (myApproved !== baseApproved || theirApproved !== baseApproved) {
    if (myApproved !== baseApproved && theirApproved !== baseApproved && myApproved !== theirApproved) {
      // 冻结为先保存者的结论，挂起裁决
      merged.review.approved = theirApproved;
      merged.review.reviewer = theirs.review.reviewer;
      merged.review.reviewedAt = theirs.review.reviewedAt;
      merged.review.reviewedVersion = theirs.review.reviewedVersion;
      changed.push(approvedField);
      pushConflict(approvedField, { present: true, text: myApproved ? '通过' : '退回' }, { present: true, text: theirApproved ? '通过' : '退回' }, true);
    } else if (myApproved !== baseApproved && theirApproved === baseApproved) {
      // 只写通过标志本身；检查项已在上面逐个标量合并，不能整体覆盖
      merged.review.approved = myApproved;
      changed.push(approvedField);
    }
  }
  // 无复核类冲突时，后保存者携带的复核元数据（复核人、时间、重新盖章信号）随其字段落位
  if (!conflicts.some((c) => c.field.startsWith('review.'))) {
    const mineReviewChanged =
      mine.review.approved !== base.review.approved ||
      mine.review.reviewedVersion !== base.review.reviewedVersion ||
      REVIEW_CHECK_IDS.some((id) => mine.review.checks[id] !== base.review.checks[id]);
    if (mineReviewChanged) {
      merged.review.reviewer = mine.review.reviewer;
      merged.review.reviewedAt = mine.review.reviewedAt;
      merged.review.reviewedVersion = mine.review.reviewedVersion;
    } else {
      const winner = theirApproved !== baseApproved ? theirs : null;
      if (winner) {
        merged.review.reviewer = winner.review.reviewer;
        merged.review.reviewedAt = winner.review.reviewedAt;
        merged.review.reviewedVersion = winner.review.reviewedVersion;
      }
    }
  }

  // 去密区域：按 id 逐个三方合并
  const regionIds = [...new Set([...base.redactions.map((r) => r.id), ...mine.redactions.map((r) => r.id), ...theirs.redactions.map((r) => r.id)])].sort();
  const mergedRegions: Redaction[] = [];
  for (const id of regionIds) {
    const field = `redaction.${id}`;
    const rb = base.redactions.find((r) => r.id === id);
    const rm = mine.redactions.find((r) => r.id === id);
    const rt = theirs.redactions.find((r) => r.id === id);
    const mineEdited = !sameValue(rb ?? null, rm ?? null);
    const theirsEdited = !sameValue(rb ?? null, rt ?? null);
    if (!mineEdited && !theirsEdited) {
      if (rb) mergedRegions.push(rb);
      continue;
    }
    if (mineEdited && theirsEdited && !sameValue(rm ?? null, rt ?? null)) {
      changed.push(field);
      pushConflict(field, redactionText(rm), redactionText(rt), Boolean(rm && rt));
      // 冻结为先保存者的区域（若对方已删除则不进结果），两份取值挂起等待裁决
      if (rt) mergedRegions.push(rt);
      continue;
    }
    const winner = mineEdited && !theirsEdited ? rm : rt;
    if (winner) mergedRegions.push(winner);
    changed.push(field);
  }
  merged.redactions = mergedRegions;

  return { fields: merged, changedFields: [...new Set(changed)], conflicts };
}

/** 裁决：把选定一方（或自定义值）写回字段集合 */
export function applyResolution(fields: VersionedFields, conflict: PendingConflict, choose: 'mine' | 'theirs', sideSource: {
  mine: VersionedFields;
  theirs: VersionedFields;
}): VersionedFields {
  const next = cloneFields(fields);
  const source = choose === 'mine' ? sideSource.mine : sideSource.theirs;
  const { field } = conflict;
  if (field === 'classification') {
    next.classification = source.classification;
    return next;
  }
  if (field === 'review.approved') {
    next.review = { ...source.review };
    return next;
  }
  for (const id of REVIEW_CHECK_IDS) {
    if (field === `review.check.${id}`) {
      next.review.checks[id] = source.review.checks[id];
      return next;
    }
  }
  if (field.startsWith('redaction.')) {
    const regionId = field.slice('redaction.'.length);
    const region = source.redactions.find((r) => r.id === regionId);
    next.redactions = next.redactions.filter((r) => r.id !== regionId);
    if (region) {
      next.redactions.push(region);
      next.redactions.sort((a, b) => a.id.localeCompare(b.id));
    }
  }
  return next;
}

// ---------- 批次发布资格 ----------

export type EligibilityReason =
  | { code: 'unconfirmed'; docId: string; text: string }
  | { code: 'conflict'; docId: string; text: string }
  | { code: 'review-stale'; docId: string; text: string }
  | { code: 'check-open'; docId: string; text: string }
  | { code: 'not-approved'; docId: string; text: string }
  | { code: 'empty'; text: string };

export type Eligibility = {
  status: 'publishable' | 'blocked';
  reasons: EligibilityReason[];
  /** 每个成员文档的版本指纹，任一变化即失效 */
  memberVersions: Record<string, number>;
  computedAt: string;
  /** 每次重算上调，和批次成员版本共同标识这份资格的新旧 */
  eligibilityVersion: number;
};

/** 单份文档阻塞发布的原因；空数组表示该文档已具备发布资格 */
export function docBlockReasons(doc: VersionedDocument): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];
  const openConflicts = doc.pendingConflicts.length;
  if (openConflicts > 0) {
    reasons.push({ code: 'conflict', docId: doc.id, text: `${openConflicts} 个字段存在双方改动，等待裁决` });
  }
  const draftRegions = doc.fields.redactions.filter((r) => r.status === 'draft').length;
  if (draftRegions > 0) {
    reasons.push({ code: 'unconfirmed', docId: doc.id, text: `${draftRegions} 个去密区域尚未确认` });
  }
  const openChecks = REVIEW_CHECK_IDS.filter((id) => !doc.fields.review.checks[id]);
  if (openChecks.length > 0) {
    reasons.push({ code: 'check-open', docId: doc.id, text: `${openChecks.length} 项发布前校验未通过` });
  }
  if (!doc.fields.review.approved) {
    reasons.push({ code: 'not-approved', docId: doc.id, text: '复核结论尚未通过' });
  } else if (
    doc.fields.review.reviewedVersion === null ||
    doc.fields.review.reviewedVersion < doc.version
  ) {
    reasons.push({ code: 'review-stale', docId: doc.id, text: `复核针对 v${doc.fields.review.reviewedVersion ?? '?'}，当前为 v${doc.version}，结论已过期` });
  }
  return reasons;
}

/** 重算批次发布资格；成员文档缺失等一致性问题直接抛错，由 store 保留上一份快照 */
export function recomputeEligibility(params: {
  memberIds: string[];
  documents: VersionedDocument[];
  previousEligibilityVersion: number;
  now: string;
}): Eligibility {
  const { memberIds, documents, now } = params;
  if (memberIds.length === 0) {
    return {
      status: 'blocked',
      reasons: [{ code: 'empty', text: '批次中没有任何文档' }],
      memberVersions: {},
      computedAt: now,
      eligibilityVersion: params.previousEligibilityVersion + 1
    };
  }
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const missing = memberIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`批次成员索引缺失：${missing.join(', ')}`);
  }
  const memberVersions: Record<string, number> = {};
  const reasons: EligibilityReason[] = [];
  for (const id of memberIds) {
    const doc = byId.get(id)!;
    memberVersions[id] = doc.version;
    reasons.push(...docBlockReasons(doc));
  }
  return {
    status: reasons.length === 0 ? 'publishable' : 'blocked',
    reasons,
    memberVersions,
    computedAt: now,
    eligibilityVersion: params.previousEligibilityVersion + 1
  };
}

/** 文档展示状态：裁决优先，再看复核，再看去密 */
export function docStatus(doc: VersionedDocument): DocumentStatus {
  if (doc.pendingConflicts.length > 0) return '待裁决';
  const reasons = docBlockReasons(doc);
  if (reasons.length === 0) return '可发布';
  if (
    doc.fields.redactions.some((r) => r.status === 'draft') ||
    reasons.some((r) => r.code === 'unconfirmed')
  ) return '去密中';
  return '待质检';
}

export const statusTone = (status: DocumentStatus): 'blue' | 'amber' | 'red' | 'green' => {
  switch (status) {
    case '可发布': return 'green';
    case '待裁决': return 'red';
    case '去密中': return 'blue';
    case '待质检': return 'amber';
  }
};
