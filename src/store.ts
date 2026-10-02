import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  applyResolution,
  cloneFields,
  diffFields,
  docStatus,
  enrichConflictPages,
  initialFieldVersions,
  initialReview,
  recomputeEligibility,
  sameValue,
  statusTone,
  threeWayMerge,
  REVIEW_CHECK_IDS,
  type Classification,
  type Eligibility,
  type EligibilityReason,
  type FieldVersions,
  type MergeRecovery,
  type PendingConflict,
  type Redaction,
  type ReviewConclusion,
  type ReviewCheckId,
  type VersionedDocument,
  type VersionedFields
} from './versioning';

export type {
  Classification,
  Eligibility,
  EligibilityReason,
  Redaction,
  ReviewConclusion,
  VersionedDocument,
  VersionedFields
};

const STORAGE_KEY = 'yy59-disclosure-draft-v2';

export type Batch = {
  id: string;
  name: string;
  memberIds: string[];
  tags: string[];
  exportNote: string;
  eligibility: Eligibility | null;
  /** 重算失败时保留的上一份可恢复快照 */
  recomputeError: string | null;
  releasedAt: string | null;
  updatedAt: string;
};

type LegacyDoc = {
  id: string;
  title: string;
  bundle: string;
  pages: number;
  classification: Classification;
  owner: string;
  updatedAt: string;
  status?: string;
  issue: string;
  size: string;
  redactions: Redaction[];
};

export const nowLabel = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const makeReview = (approved: boolean, reviewer: string, reviewedAt: string | null, version: number): ReviewConclusion =>
  initialReview({
    checks: {
      'forbidden-terms': approved,
      'page-number': approved,
      'image-boundary': approved,
      metadata: approved
    },
    approved,
    reviewer: approved ? reviewer : '',
    reviewedAt: approved ? reviewedAt : null,
    reviewedVersion: approved ? version : null
  });

const buildFieldVersions = (redactions: Redaction[]): FieldVersions => ({
  ...initialFieldVersions(),
  redactions: Object.fromEntries(redactions.map((r) => [r.id, 1]))
});

function makeSeedDoc(input: {
  id: string;
  title: string;
  bundle: string;
  pages: number;
  classification: Classification;
  owner: string;
  updatedAt: string;
  issue: string;
  size: string;
  redactions: Redaction[];
  review: ReviewConclusion;
}): VersionedDocument {
  const fields: VersionedFields = {
    classification: input.classification,
    review: input.review,
    redactions: input.redactions
  };
  return {
    id: input.id,
    title: input.title,
    bundle: input.bundle,
    pages: input.pages,
    owner: input.owner,
    issue: input.issue,
    size: input.size,
    updatedAt: input.updatedAt,
    fields,
    version: 1,
    fieldVersions: buildFieldVersions(input.redactions),
    pendingConflicts: [],
    recovery: null
  };
}

const seedRedactions = {
  doc418: [
    { id: 'R-01', page: 1, x: 0.12, y: 0.16, width: 0.3, height: 0.04, reason: '商业秘密', privilege: '合同保密', status: 'confirmed' as const },
    { id: 'R-02', page: 1, x: 0.5, y: 0.43, width: 0.34, height: 0.06, reason: '个人手机号', privilege: '个人信息', status: 'draft' as const },
    { id: 'R-03', page: 2, x: 0.11, y: 0.25, width: 0.68, height: 0.05, reason: '第三方报价', privilege: '商业敏感', status: 'confirmed' as const }
  ],
  doc427: [{ id: 'R-04', page: 1, x: 0.08, y: 0.69, width: 0.74, height: 0.05, reason: '内部调查意见', privilege: '工作成果', status: 'confirmed' as const }],
  doc435: [{ id: 'R-05', page: 2, x: 0.44, y: 0.56, width: 0.26, height: 0.04, reason: '人员姓名', privilege: '个人信息', status: 'confirmed' as const }]
};

const buildSeedDocuments = (): VersionedDocument[] => [
  makeSeedDoc({
    id: 'DOC-00418',
    title: '设备采购补充协议（第三版）',
    bundle: '北岭项目 · 第一批披露',
    pages: 3,
    classification: '严格机密',
    owner: '林清',
    updatedAt: '09:48',
    issue: '合同主体与商业条款',
    size: '8.4 MB',
    redactions: seedRedactions.doc418,
    review: makeReview(false, '', null, 1)
  }),
  makeSeedDoc({
    id: 'DOC-00427',
    title: '现场会议纪要 2026-08-19',
    bundle: '北岭项目 · 第一批披露',
    pages: 3,
    classification: '机密',
    owner: '周叙',
    updatedAt: '09:31',
    issue: '事故预防与整改安排',
    size: '3.1 MB',
    redactions: seedRedactions.doc427,
    review: makeReview(false, '', null, 1)
  }),
  makeSeedDoc({
    id: 'DOC-00435',
    title: '设备运行数据摘录',
    bundle: '北岭项目 · 第二批披露',
    pages: 3,
    classification: '内部',
    owner: '顾言',
    updatedAt: '08:56',
    issue: '运行记录',
    size: '12.7 MB',
    redactions: seedRedactions.doc435,
    review: makeReview(true, '顾言', '08:56', 1)
  })
];

/** 旧稿升级：回填版本号与索引，但原有区域、密级和复核结论全部保留 */
export function migrateLegacyDoc(raw: LegacyDoc, index: number): VersionedDocument {
  const review =
    raw.status === '可发布'
      ? makeReview(true, raw.owner, raw.updatedAt, 1)
      : makeReview(false, '', null, 1);
  const fields: VersionedFields = {
    classification: raw.classification,
    review,
    redactions: raw.redactions.map((r) => ({ ...r }))
  };
  return {
    id: raw.id,
    title: raw.title,
    bundle: raw.bundle,
    pages: raw.pages,
    owner: raw.owner,
    issue: raw.issue,
    size: raw.size,
    updatedAt: raw.updatedAt,
    fields,
    version: 1,
    fieldVersions: buildFieldVersions(raw.redactions),
    pendingConflicts: [],
    recovery: null
  };
}

const makeBatch = (
  id: string,
  name: string,
  memberIds: string[],
  tags: string[],
  exportNote: string,
  documents: VersionedDocument[]
): Batch => {
  const time = nowLabel();
  const eligibility = recomputeEligibility({
    memberIds,
    documents,
    previousEligibilityVersion: 0,
    now: time
  });
  return {
    id,
    name,
    memberIds,
    tags,
    exportNote,
    eligibility,
    recomputeError: null,
    releasedAt: null,
    updatedAt: time
  };
};

const buildSeedBatches = (documents: VersionedDocument[]): Batch[] => [
  makeBatch(
    'BATCH-01',
    '第一批披露',
    ['DOC-00418', 'DOC-00427'],
    ['合同问题', '设备缺陷', '现场安全'],
    '按案卷编号升序导出，保留去密版本、操作者与审批时间。',
    documents
  ),
  makeBatch(
    'BATCH-02',
    '第二批披露',
    ['DOC-00435'],
    ['设备缺陷'],
    '运行记录已完成双人复核，按发布版本导出。',
    documents
  ),
  makeBatch('BATCH-03', '专家材料', [], ['仅律师可见'], '等待补充材料入库后再编制成员。', documents)
];

export type CommitRequest = {
  docId: string;
  editor: string;
  baseVersion: number;
  baseFields: VersionedFields;
  fields: VersionedFields;
};

export type CommitResult =
  | { ok: true; docId: string; version: number; conflicts: PendingConflict[]; fastForwarded: boolean }
  | { ok: false; docId: string; error: string };

type State = {
  documents: VersionedDocument[];
  batches: Batch[];
  activeDocumentId: string;
  activePage: number;
  activeRedactionId: string | null;
  redactionMode: boolean;
  /** 仅本标签页有效的故障演练开关：下一次重算抛错 */
  failNextRecompute: boolean;
  /** 标记最后写入者，跨标签页同步时跳过自己的写入 */
  writerId: string;
  selectDocument: (id: string) => void;
  setPage: (page: number) => void;
  toggleRedactionMode: () => void;
  selectRedaction: (id: string | null) => void;
  commitEdits: (request: CommitRequest) => CommitResult;
  resolveConflict: (docId: string, conflictId: string, choose: 'mine' | 'theirs') => void;
  retryMerge: (docId: string) => CommitResult;
  restoreSnapshot: (docId: string) => void;
  saveBatch: (batchId: string, patch: { memberIds?: string[]; tags?: string[]; exportNote?: string }) => void;
  recomputeBatch: (batchId: string) => void;
  armRecomputeFailure: () => void;
  releaseBatch: (batchId: string) => void;
  /** 接收其它标签页广播过来的已持久化状态 */
  ingestRemote: (remote: Pick<State, 'documents' | 'batches'>) => void;
};

const tabId = `tab-${Math.random().toString(36).slice(2, 9)}`;

const initialDocuments = buildSeedDocuments();
const initialBatches = buildSeedBatches(initialDocuments);

/**
 * 核心装配：应用一次提交结果，更新文档版本/字段版本/冲突/恢复快照，
 * 并立即让所有受影响批次的发布资格失效并重算。
 */
function applyMergedFields(
  state: State,
  request: CommitRequest,
  options: { recoveryReason: string | null; keepSnapshot?: VersionedDocument }
): { documents: VersionedDocument[]; batches: Batch[]; result: CommitResult } {
  const target = state.documents.find((doc) => doc.id === request.docId);
  if (!target) {
    return {
      documents: state.documents,
      batches: state.batches,
      result: { ok: false, docId: request.docId, error: '文档索引缺失，无法提交' }
    };
  }

  const snapshotDoc: VersionedDocument = JSON.parse(
    JSON.stringify(options.keepSnapshot ?? target)
  );
  const recovery: MergeRecovery = {
    snapshotDoc,
    baseFields: cloneFields(request.baseFields),
    baseVersion: request.baseVersion,
    mineFields: cloneFields(request.fields),
    theirsFields: cloneFields(target.fields),
    editor: request.editor,
    reason: options.recoveryReason,
    at: nowLabel()
  };

  // 远端版本已经领先：以提交时的基线做三方合并，只合入无冲突字段，冲突保留两份
  const outcome = threeWayMerge({
    docId: request.docId,
    base: request.baseFields,
    mine: request.fields,
    theirs: target.fields
  });

  const changedFields = outcome.changedFields;
  const nextVersion = target.version + 1;
  const nextFieldVersions: FieldVersions = JSON.parse(JSON.stringify(target.fieldVersions));
  if (changedFields.includes('classification')) nextFieldVersions.classification += 1;
  for (const id of REVIEW_CHECK_IDS) {
    if (changedFields.includes(`review.check.${id}`)) nextFieldVersions.review[id] += 1;
  }
  if (changedFields.includes('review.approved')) nextFieldVersions.review.approved += 1;
  const changedRegionIds = new Set(
    changedFields.filter((f) => f.startsWith('redaction.')).map((f) => f.slice('redaction.'.length))
  );
  for (const id of changedRegionIds) {
    if (outcome.fields.redactions.some((r) => r.id === id)) {
      nextFieldVersions.redactions[id] = (nextFieldVersions.redactions[id] ?? 1) + 1;
    } else {
      delete nextFieldVersions.redactions[id];
    }
  }

  // 复核结论随合并落定：
  // - 本次提交确实包含复核动作、且无复核类冲突时，“通过”结论按新版本盖章；
  // - 一旦结论或检查项双方打架，结论立即失效等待重做；
  // - 本次没碰复核字段（如只改密级/区域）：旧结论保持原 reviewedVersion，
  //   版本上调后自然过期阻塞，不会被静默重新盖章。
  const reviewTouched = changedFields.some((f) => f.startsWith('review.'));
  const reviewConflict = outcome.conflicts.some((c) => c.field.startsWith('review.'));
  const nextReview: ReviewConclusion = { ...outcome.fields.review };
  if (reviewTouched && !reviewConflict && nextReview.approved) {
    nextReview.reviewedVersion = nextVersion;
    if (!nextReview.reviewer) nextReview.reviewer = request.editor;
    if (!nextReview.reviewedAt) nextReview.reviewedAt = nowLabel();
  } else if (reviewTouched || reviewConflict) {
    nextReview.reviewedVersion = null;
    if (reviewConflict) {
      nextReview.approved = false;
      nextReview.reviewer = '';
      nextReview.reviewedAt = null;
    }
  }
  outcome.fields.review = nextReview;

  // 本次非冲突合并若改动了某个旧冲突字段，说明该字段已被正常提交覆盖，旧冲突一并清掉
  const mergedConflictFields = new Set(outcome.conflicts.map((c) => c.field));
  const keptConflicts = target.pendingConflicts
    .filter((c) => !mergedConflictFields.has(c.field) && !changedFields.includes(c.field));
  const pendingConflicts = enrichConflictPages({
    ...target,
    fields: outcome.fields,
    pendingConflicts: [...keptConflicts, ...outcome.conflicts]
  } as VersionedDocument);

  const updatedDoc: VersionedDocument = {
    ...target,
    fields: outcome.fields,
    version: nextVersion,
    fieldVersions: nextFieldVersions,
    pendingConflicts,
    recovery,
    updatedAt: nowLabel()
  };

  const documents = state.documents.map((doc) => (doc.id === request.docId ? updatedDoc : doc));
  const batches = recomputeAffected(state, request.docId, documents);

  return {
    documents,
    batches,
    result: { ok: true, docId: request.docId, version: nextVersion, conflicts: outcome.conflicts, fastForwarded: false }
  };
}

/** 文档版本变化后，立即重算包含该文档的批次发布资格；失败则保留上一份快照 */
function recomputeAffected(state: State, docId: string, documents: VersionedDocument[]): Batch[] {
  const failThisRound = state.failNextRecompute;
  return state.batches.map((batch) => {
    if (!batch.memberIds.includes(docId)) return batch;
    if (failThisRound) {
      return {
        ...batch,
        recomputeError: `重算失败（${nowLabel()}）：成员版本索引暂不可用，已保留上一份资格快照，可重试`,
        updatedAt: nowLabel()
      };
    }
    try {
      const eligibility = recomputeEligibility({
        memberIds: batch.memberIds,
        documents,
        previousEligibilityVersion: batch.eligibility?.eligibilityVersion ?? 0,
        now: nowLabel()
      });
      return { ...batch, eligibility, recomputeError: null, updatedAt: nowLabel() };
    } catch (error) {
      return {
        ...batch,
        recomputeError: error instanceof Error ? error.message : '未知重算错误，已保留上一份资格快照',
        updatedAt: nowLabel()
      };
    }
  });
}

export const useDisclosureStore = create<State>()(
  persist(
    (set) => ({
      documents: initialDocuments,
      batches: initialBatches,
      activeDocumentId: initialDocuments[0].id,
      activePage: 1,
      activeRedactionId: 'R-02',
      redactionMode: false,
      failNextRecompute: false,
      writerId: tabId,

      selectDocument: (id) => set({ activeDocumentId: id, activePage: 1, activeRedactionId: null, redactionMode: false }),
      setPage: (page) => set({ activePage: page }),
      toggleRedactionMode: () => set((state) => ({ redactionMode: !state.redactionMode })),
      selectRedaction: (id) => set({ activeRedactionId: id }),

      commitEdits: (request) => {
        let result: CommitResult = { ok: false, docId: request.docId, error: '未执行' };
        set((state) => {
          const target = state.documents.find((doc) => doc.id === request.docId);
          if (!target) {
            result = { ok: false, docId: request.docId, error: '文档索引缺失，无法提交' };
            return state;
          }

          const changed = diffFields(request.baseFields, request.fields);

          // 基线就是当前版本：无冲突直提；版本号仅在受控字段真实变化时上调
          if (request.baseVersion === target.version) {
            if (changed.length === 0 && target.pendingConflicts.length === 0) {
              result = { ok: true, docId: request.docId, version: target.version, conflicts: [], fastForwarded: true };
              return { failNextRecompute: false };
            }
            const applied = applyMergedFields(state, request, {
              recoveryReason: changed.length === 0 ? '提交仅用于清理待裁决字段' : null
            });
            result = applied.result;
            return { documents: applied.documents, batches: applied.batches, failNextRecompute: false };
          }

          // 落后于远端：即便本地没有净改动也要先跑合并，把远端版本取回来
          const applied = applyMergedFields(state, request, { recoveryReason: '并发提交三方合并' });
          result = applied.result;
          return { documents: applied.documents, batches: applied.batches, failNextRecompute: false };
        });
        return result;
      },

      resolveConflict: (docId, conflictId, choose) => {
        set((state) => {
          const doc = state.documents.find((item) => item.id === docId);
          if (!doc) return state;
          const conflict = doc.pendingConflicts.find((item) => item.id === conflictId);
          if (!conflict || !doc.recovery) return state;

          // 裁决的两方来源都保存在合并恢复上下文中，取的是双方当时提交的完整字段
          const mine = doc.recovery.mineFields;
          const theirs = doc.recovery.theirsFields;
          const withResolution = applyResolution(doc.fields, conflict, choose, { mine, theirs });
          const remaining = doc.pendingConflicts.filter((item) => item.id !== conflictId);
          const nextVersion = doc.version + 1;

          const fieldVersions: FieldVersions = JSON.parse(JSON.stringify(doc.fieldVersions));
          if (conflict.field === 'classification') fieldVersions.classification += 1;
          if (conflict.field.startsWith('review.check.')) {
            const id = conflict.field.slice('review.check.'.length) as ReviewCheckId;
            fieldVersions.review[id] += 1;
          }
          if (conflict.field === 'review.approved') fieldVersions.review.approved += 1;
          if (conflict.field.startsWith('redaction.')) {
            const regionId = conflict.field.slice('redaction.'.length);
            if (withResolution.redactions.some((r) => r.id === regionId)) {
              fieldVersions.redactions[regionId] = (fieldVersions.redactions[regionId] ?? 1) + 1;
            } else {
              delete fieldVersions.redactions[regionId];
            }
          }

          // 只有复核类字段被裁决时，结论才必须重做；密级/区域裁决不抹掉已有复核
          // （但内容版本变了，reviewedVersion 仍停留在旧版本，资格重算会判定过期）
          const review: ReviewConclusion = { ...withResolution.review };
          if (conflict.field.startsWith('review.')) {
            review.approved = false;
            review.reviewer = '';
            review.reviewedAt = null;
            review.reviewedVersion = null;
          }
          withResolution.review = review;

          // 全部冲突裁决完才算“完整合并”：清掉恢复上下文；在此之前批次始终被阻塞
          const recovery = remaining.length > 0 ? doc.recovery : null;

          const updatedDoc: VersionedDocument = {
            ...doc,
            fields: withResolution,
            version: nextVersion,
            fieldVersions: fieldVersions,
            pendingConflicts: remaining,
            recovery,
            updatedAt: nowLabel()
          };
          const documents = state.documents.map((item) => (item.id === docId ? updatedDoc : item));
          const batches = recomputeAffected(state, docId, documents);
          return { documents, batches };
        });
      },

      retryMerge: (docId) => {
        let result: CommitResult = { ok: false, docId, error: '未执行' };
        set((state) => {
          const doc = state.documents.find((item) => item.id === docId);
          if (!doc || !doc.recovery) {
            result = { ok: false, docId, error: '没有可重试的合并记录' };
            return state;
          }
          // 重试仍以最初那份合并前快照为可恢复点，保证重试不会把重试本身变成新“旧版本”
          const request: CommitRequest = {
            docId,
            editor: doc.recovery.editor,
            baseVersion: doc.recovery.baseVersion,
            baseFields: doc.recovery.baseFields,
            fields: doc.recovery.snapshotDoc.fields
          };
          const applied = applyMergedFields(state, request, {
            recoveryReason: '重试上次合并',
            keepSnapshot: doc.recovery.snapshotDoc
          });
          result = applied.result;
          return { documents: applied.documents, batches: applied.batches };
        });
        return result;
      },

      restoreSnapshot: (docId) => {
        set((state) => {
          const doc = state.documents.find((item) => item.id === docId);
          if (!doc?.recovery) return state;
          const restored = doc.recovery.snapshotDoc;
          // 版本号保持单调递增：快照作为新版本回填，避免对方标签页基线错乱
          const nextVersion = doc.version + 1;
          const updatedDoc: VersionedDocument = {
            ...restored,
            version: nextVersion,
            pendingConflicts: [],
            recovery: null,
            updatedAt: nowLabel()
          };
          const documents = state.documents.map((item) => (item.id === docId ? updatedDoc : item));
          const batches = recomputeAffected(state, docId, documents);
          return { documents, batches };
        });
      },

      saveBatch: (batchId, patch) => {
        set((state) => {
          const documents = state.documents;
          const batches = state.batches.map((batch) => {
            if (batch.id !== batchId) return batch;
            const next: Batch = {
              ...batch,
              memberIds: patch.memberIds ?? batch.memberIds,
              tags: patch.tags ?? batch.tags,
              exportNote: patch.exportNote ?? batch.exportNote,
              updatedAt: nowLabel()
            };
            // 成员或内容一变，旧资格立即失效并重算；失败保留上一份快照
            try {
              if (state.failNextRecompute) throw new Error('模拟重算失败：成员版本索引暂不可用');
              next.eligibility = recomputeEligibility({
                memberIds: next.memberIds,
                documents,
                previousEligibilityVersion: batch.eligibility?.eligibilityVersion ?? 0,
                now: nowLabel()
              });
              next.recomputeError = null;
            } catch (error) {
              next.eligibility = batch.eligibility;
              next.recomputeError = error instanceof Error ? error.message : '未知重算错误，已保留上一份资格快照';
            }
            return next;
          });
          return { batches, failNextRecompute: false };
        });
      },

      recomputeBatch: (batchId) => {
        set((state) => {
          const batches = state.batches.map((batch) => {
            if (batch.id !== batchId) return batch;
            if (state.failNextRecompute) {
              return {
                ...batch,
                recomputeError: `重算失败（${nowLabel()}）：成员版本索引暂不可用，已保留上一份资格快照，可重试`,
                updatedAt: nowLabel()
              };
            }
            try {
              const eligibility = recomputeEligibility({
                memberIds: batch.memberIds,
                documents: state.documents,
                previousEligibilityVersion: batch.eligibility?.eligibilityVersion ?? 0,
                now: nowLabel()
              });
              return { ...batch, eligibility, recomputeError: null, updatedAt: nowLabel() };
            } catch (error) {
              return {
                ...batch,
                recomputeError: error instanceof Error ? error.message : '未知重算错误，已保留上一份资格快照',
                updatedAt: nowLabel()
              };
            }
          });
          return { batches, failNextRecompute: false };
        });
      },

      armRecomputeFailure: () => set({ failNextRecompute: true }),

      releaseBatch: (batchId) => {
        set((state) => ({
          batches: state.batches.map((batch) =>
            batch.id === batchId && batch.eligibility?.status === 'publishable' && !batch.recomputeError
              ? { ...batch, releasedAt: nowLabel(), updatedAt: nowLabel() }
              : batch
          )
        }));
      },

      ingestRemote: (remote) => {
        set((state) => {
          if (sameValue(state.documents, remote.documents) && sameValue(state.batches, remote.batches)) {
            return state;
          }
          // 只接收远端的文档/批次事实，本标签页的绘制状态不被覆盖
          return { documents: remote.documents, batches: remote.batches };
        });
      }
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      partialize: (state) => ({
        documents: state.documents,
        batches: state.batches,
        activeDocumentId: state.activeDocumentId,
        writerId: state.writerId
      }),
      migrate: (persisted: unknown, version) => {
        const p = (persisted ?? {}) as Record<string, unknown> & Partial<State>;
        const rawDocs = p.documents as unknown;
        if (
          version < 2 &&
          Array.isArray(rawDocs) &&
          rawDocs.length > 0 &&
          typeof rawDocs[0] === 'object' &&
          rawDocs[0] !== null &&
          'classification' in rawDocs[0] &&
          !('fields' in rawDocs[0])
        ) {
          // 旧稿升级：补回填版本与字段索引，原区域、密级、复核结论保留
          const migrated = (rawDocs as LegacyDoc[]).map((doc, index) => migrateLegacyDoc(doc, index));
          p.documents = migrated;
          p.batches = buildSeedBatches(migrated);
        }
        delete (p as Record<string, unknown>).reviewChecks;
        delete (p as Record<string, unknown>).metadataCleaned;
        return p as State;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return {
          ...current,
          ...p,
          // 故障演练开关不持久化，刷新即复位
          failNextRecompute: false,
          redactionMode: false
        } as State;
      }
    }
  )
);

// 跨标签页协作：其它标签页保存后，通过 storage 事件把新事实同步过来
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as { state?: { documents?: VersionedDocument[]; batches?: Batch[]; writerId?: string } };
      const remote = parsed.state;
      if (!remote?.documents || !remote?.batches) return;
      if (remote.writerId === tabId) return; // 忽略本标签页自己的持久化广播
      useDisclosureStore.getState().ingestRemote({ documents: remote.documents, batches: remote.batches });
    } catch {
      // 损坏的广播直接忽略，不影响本地草稿
    }
  });
}

export { docStatus, statusTone };
export type { DocumentStatus } from './versioning';
