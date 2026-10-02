import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ---------- types ----------
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

export type ReviewChecks = Record<string, boolean>;
export type DocVersion = { major: number; minor: number };
export type ReviewState = {
  checks: ReviewChecks;
  metadataCleaned: boolean;
  decision: 'pending' | 'passed' | 'rejected';
  approvedVersion: DocVersion | null;
};

export type DisclosureRecord = {
  id: string;
  title: string;
  bundle: string;
  batchId: string;
  pages: number;
  classification: '内部' | '机密' | '严格机密';
  owner: string;
  updatedAt: string;
  status: '去密中' | '待质检' | '可发布';
  issue: string;
  size: string;
  redactions: Redaction[];
  version: DocVersion;
  review: ReviewState;
};

export type Batch = {
  id: string;
  name: string;
  documentIds: string[];
  status: '编制中' | '审阅中' | '可发布' | '已失效';
  releaseEligible: boolean;
  lastRecalcAt: string | null;
};

export type RegionConflict = {
  kind: 'region';
  docId: string;
  regionId: string;
  local: Redaction | null;
  remote: Redaction | null;
};
export type FieldConflict = {
  kind: 'field';
  docId: string;
  field: string;
  local: unknown;
  remote: unknown;
};
export type Conflict = RegionConflict | FieldConflict;

export type MergeStatus = 'idle' | 'merging' | 'conflict' | 'failed';
export type PersistedSlice = { documents: DisclosureRecord[]; batches: Batch[] };

// ---------- constants ----------
export const STORAGE_KEY = 'yy59-disclosure-draft';
const STORAGE_VERSION = 2;
export const defaultChecks: ReviewChecks = {
  'forbidden-terms': false,
  'page-number': false,
  'image-boundary': false,
  'metadata': false
};
const defaultVersion: DocVersion = { major: 1, minor: 0 };

export const reviewCheckDefs = [
  { id: 'forbidden-terms', label: '全文禁词与姓名复核', detail: '扫描原始页和发布页文本层' },
  { id: 'page-number', label: '页序与页码连续性', detail: '检查拆页、合并及漏页情况' },
  { id: 'image-boundary', label: '图像边界残片', detail: '逐页比较遮蔽边界 2mm 区域' },
  { id: 'metadata', label: '文档元数据清理', detail: '作者、修订人、批注和隐藏字段' }
];

const defaultDocuments: DisclosureRecord[] = [
  {
    id: 'DOC-00418',
    title: '设备采购补充协议（第三版）',
    bundle: '北岭项目 · 第一批披露',
    batchId: 'BATCH-01',
    pages: 3,
    classification: '严格机密',
    owner: '林清',
    updatedAt: '09:48',
    status: '去密中',
    issue: '合同主体与商业条款',
    size: '8.4 MB',
    version: { major: 1, minor: 0 },
    review: { checks: { ...defaultChecks }, metadataCleaned: false, decision: 'pending', approvedVersion: null },
    redactions: [
      { id: 'R-01', page: 1, x: 0.12, y: 0.16, width: 0.30, height: 0.04, reason: '商业秘密', privilege: '合同保密', status: 'confirmed' },
      { id: 'R-02', page: 1, x: 0.50, y: 0.43, width: 0.34, height: 0.06, reason: '个人手机号', privilege: '个人信息', status: 'draft' },
      { id: 'R-03', page: 2, x: 0.11, y: 0.25, width: 0.68, height: 0.05, reason: '第三方报价', privilege: '商业敏感', status: 'confirmed' }
    ]
  },
  {
    id: 'DOC-00427',
    title: '现场会议纪要 2026-08-19',
    bundle: '北岭项目 · 第一批披露',
    batchId: 'BATCH-01',
    pages: 3,
    classification: '机密',
    owner: '周叙',
    updatedAt: '09:31',
    status: '待质检',
    issue: '事故预防与整改安排',
    size: '3.1 MB',
    version: { major: 1, minor: 0 },
    review: { checks: { ...defaultChecks }, metadataCleaned: false, decision: 'pending', approvedVersion: null },
    redactions: [
      { id: 'R-04', page: 1, x: 0.08, y: 0.69, width: 0.74, height: 0.05, reason: '内部调查意见', privilege: '工作成果', status: 'confirmed' }
    ]
  },
  {
    id: 'DOC-00435',
    title: '设备运行数据摘录',
    bundle: '北岭项目 · 第二批披露',
    batchId: 'BATCH-02',
    pages: 3,
    classification: '内部',
    owner: '顾言',
    updatedAt: '08:56',
    status: '可发布',
    issue: '运行记录',
    size: '12.7 MB',
    version: { major: 1, minor: 0 },
    review: {
      checks: { 'forbidden-terms': true, 'page-number': true, 'image-boundary': true, 'metadata': true },
      metadataCleaned: true,
      decision: 'passed',
      approvedVersion: { major: 1, minor: 0 }
    },
    redactions: [
      { id: 'R-05', page: 2, x: 0.44, y: 0.56, width: 0.26, height: 0.04, reason: '人员姓名', privilege: '个人信息', status: 'confirmed' }
    ]
  }
];

const defaultBatches: Batch[] = [
  { id: 'BATCH-01', name: '第一批披露', documentIds: ['DOC-00418', 'DOC-00427'], status: '审阅中', releaseEligible: false, lastRecalcAt: null },
  { id: 'BATCH-02', name: '第二批披露', documentIds: ['DOC-00435'], status: '编制中', releaseEligible: false, lastRecalcAt: null },
  { id: 'BATCH-03', name: '专家材料', documentIds: [], status: '编制中', releaseEligible: false, lastRecalcAt: null }
];

// ---------- helpers ----------
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function formatVersion(version: DocVersion | null | undefined): string {
  if (!version) return '—';
  return `版本 ${version.major}.${version.minor}`;
}

function bumpVersion(version: DocVersion): DocVersion {
  return { major: version.major, minor: version.minor + 1 };
}

function maxVersion(a: DocVersion, b: DocVersion): DocVersion {
  if (a.major !== b.major) return a.major > b.major ? a : b;
  return a.minor > b.minor ? a : b;
}

export function isDocPassed(doc: DisclosureRecord): boolean {
  const allConfirmed = doc.redactions.length > 0 && doc.redactions.every((r) => r.status === 'confirmed');
  const checksPassed = reviewCheckDefs.every((c) => doc.review.checks[c.id]);
  return (
    doc.review.decision === 'passed' &&
    doc.review.approvedVersion !== null &&
    deepEqual(doc.review.approvedVersion, doc.version) &&
    checksPassed &&
    doc.review.metadataCleaned &&
    allConfirmed
  );
}

export function deriveDocStatus(doc: DisclosureRecord): DisclosureRecord['status'] {
  if (isDocPassed(doc)) return '可发布';
  if (doc.redactions.some((r) => r.status === 'draft')) return '去密中';
  return '待质检';
}

function gateOpen(mergeStatus: MergeStatus, conflicts: Conflict[]): boolean {
  return mergeStatus === 'idle' && conflicts.length === 0;
}

function recalcBatches(documents: DisclosureRecord[], batches: Batch[], open: boolean): Batch[] {
  return batches.map((batch) => {
    const docs = batch.documentIds
      .map((id) => documents.find((d) => d.id === id))
      .filter((d): d is DisclosureRecord => Boolean(d));
    const allPassed = docs.length > 0 && docs.every(isDocPassed);
    const releaseEligible = open && allPassed;
    const wasEligible = batch.status === '可发布';
    const staleApproval = docs.some(
      (d) => d.review.decision === 'passed' && d.review.approvedVersion && !deepEqual(d.review.approvedVersion, d.version)
    );
    let status: Batch['status'];
    if (!open) status = '已失效';
    else if (releaseEligible) status = '可发布';
    else if (wasEligible || staleApproval) status = '已失效';
    else if (docs.some((d) => d.review.decision === 'passed' || d.status === '待质检')) status = '审阅中';
    else status = '编制中';
    return { ...batch, releaseEligible, status, lastRecalcAt: new Date().toISOString() };
  });
}

function recalcAll(state: { documents: DisclosureRecord[]; batches: Batch[]; mergeStatus: MergeStatus; conflicts: Conflict[] }) {
  return {
    documents: state.documents.map((d) => ({ ...d, status: deriveDocStatus(d) })),
    batches: recalcBatches(state.documents, state.batches, gateOpen(state.mergeStatus, state.conflicts))
  };
}

// ---------- field merge ----------
function mergeField<T>(bv: T | undefined, lv: T | undefined, rv: T | undefined): { value: T; conflict: boolean } {
  if (bv === undefined) {
    if (lv !== undefined && rv !== undefined) {
      if (deepEqual(lv, rv)) return { value: lv, conflict: false };
      return { value: rv, conflict: true };
    }
    if (rv !== undefined) return { value: rv, conflict: false };
    return { value: lv as T, conflict: false };
  }
  const localChanged = lv !== undefined && !deepEqual(lv, bv);
  const remoteChanged = rv !== undefined && !deepEqual(rv, bv);
  if (localChanged && remoteChanged) {
    if (deepEqual(lv, rv)) return { value: lv as T, conflict: false };
    return { value: rv as T, conflict: true };
  }
  if (localChanged) return { value: lv as T, conflict: false };
  if (remoteChanged) return { value: rv as T, conflict: false };
  return { value: bv, conflict: false };
}

function getField(doc: DisclosureRecord, field: string): unknown {
  if (field === 'classification') return doc.classification;
  if (field === 'metadataCleaned') return doc.review.metadataCleaned;
  if (field === 'decision') return doc.review.decision;
  if (field === 'approvedVersion') return doc.review.approvedVersion;
  if (field.startsWith('check:')) return doc.review.checks[field.slice(6)];
  return undefined;
}

function setField(doc: DisclosureRecord, field: string, value: unknown): DisclosureRecord {
  if (field === 'classification') return { ...doc, classification: value as DisclosureRecord['classification'] };
  if (field === 'metadataCleaned') return { ...doc, review: { ...doc.review, metadataCleaned: Boolean(value) } };
  if (field === 'decision') return { ...doc, review: { ...doc.review, decision: value as ReviewState['decision'] } };
  if (field === 'approvedVersion') return { ...doc, review: { ...doc.review, approvedVersion: value as DocVersion | null } };
  if (field.startsWith('check:')) {
    const key = field.slice(6);
    return { ...doc, review: { ...doc.review, checks: { ...doc.review.checks, [key]: Boolean(value) } } };
  }
  return doc;
}

// ---------- region merge ----------
function mergeRegions(
  docId: string,
  baseR: Redaction[],
  localR: Redaction[],
  remoteR: Redaction[]
): { merged: Redaction[]; conflicts: RegionConflict[] } {
  const conflicts: RegionConflict[] = [];
  const ids = new Set([...baseR.map((r) => r.id), ...localR.map((r) => r.id), ...remoteR.map((r) => r.id)]);
  const merged: Redaction[] = [];
  for (const id of ids) {
    const b = baseR.find((r) => r.id === id);
    const l = localR.find((r) => r.id === id);
    const r = remoteR.find((r) => r.id === id);
    const inB = Boolean(b);
    const inL = Boolean(l);
    const inR = Boolean(r);
    if (!inB) {
      if (inL && inR) {
        if (deepEqual(l, r)) merged.push(clone(r!));
        else {
          conflicts.push({ kind: 'region', docId, regionId: id, local: clone(l!), remote: clone(r!) });
          merged.push(clone(r!));
        }
      } else if (inR) merged.push(clone(r!));
      else if (inL) merged.push(clone(l!));
      continue;
    }
    const localChanged = inL && !deepEqual(l, b);
    const remoteChanged = inR && !deepEqual(r, b);
    if (!inL && !inR) continue;
    if (!inL && inR) {
      if (remoteChanged) {
        conflicts.push({ kind: 'region', docId, regionId: id, local: null, remote: clone(r!) });
        merged.push(clone(r!));
      }
      continue;
    }
    if (inL && !inR) {
      if (localChanged) {
        conflicts.push({ kind: 'region', docId, regionId: id, local: clone(l!), remote: null });
        merged.push(clone(l!));
      }
      continue;
    }
    if (localChanged && remoteChanged) {
      if (deepEqual(l, r)) merged.push(clone(r!));
      else {
        conflicts.push({ kind: 'region', docId, regionId: id, local: clone(l!), remote: clone(r!) });
        merged.push(clone(r!));
      }
    } else if (localChanged) merged.push(clone(l!));
    else if (remoteChanged) merged.push(clone(r!));
    else merged.push(clone(r ?? b!));
  }
  return { merged, conflicts };
}

// ---------- document merge ----------
function mergeDocuments(
  base: DisclosureRecord[],
  local: DisclosureRecord[],
  remote: DisclosureRecord[]
): { docs: DisclosureRecord[]; conflicts: Conflict[] } {
  const conflicts: Conflict[] = [];
  const byId = new Map<string, { b?: DisclosureRecord; l?: DisclosureRecord; r?: DisclosureRecord }>();
  for (const d of base) byId.set(d.id, { ...byId.get(d.id), b: d });
  for (const d of local) byId.set(d.id, { ...byId.get(d.id), l: d });
  for (const d of remote) byId.set(d.id, { ...byId.get(d.id), r: d });

  const docs: DisclosureRecord[] = [];
  for (const [id, trio] of byId) {
    const { b, l, r } = trio;
    if (!l && !r) continue;
    const doc: DisclosureRecord = clone(r ?? l ?? b!);

    const versions = [b?.version, l?.version, r?.version].filter((v): v is DocVersion => Boolean(v));
    doc.version = versions.reduce((acc, v) => maxVersion(acc, v), defaultVersion);

    const classMerge = mergeField(b?.classification, l?.classification, r?.classification);
    if (classMerge.conflict) conflicts.push({ kind: 'field', docId: id, field: 'classification', local: l?.classification, remote: r?.classification });
    doc.classification = classMerge.value;

    const review: ReviewState = { ...doc.review, checks: { ...doc.review.checks } };
    for (const field of ['metadataCleaned', 'decision', 'approvedVersion'] as const) {
      const m = mergeField(b?.review?.[field], l?.review?.[field], r?.review?.[field]);
      if (m.conflict) conflicts.push({ kind: 'field', docId: id, field, local: l?.review?.[field], remote: r?.review?.[field] });
      (review as Record<string, unknown>)[field] = m.value;
    }
    const checkKeys = new Set([
      ...Object.keys(b?.review?.checks ?? {}),
      ...Object.keys(l?.review?.checks ?? {}),
      ...Object.keys(r?.review?.checks ?? {})
    ]);
    for (const key of checkKeys) {
      const m = mergeField(b?.review?.checks?.[key], l?.review?.checks?.[key], r?.review?.checks?.[key]);
      if (m.conflict) conflicts.push({ kind: 'field', docId: id, field: `check:${key}`, local: l?.review?.checks?.[key], remote: r?.review?.checks?.[key] });
      review.checks[key] = m.value;
    }
    doc.review = review;

    const { merged: mergedR, conflicts: regionConflicts } = mergeRegions(id, b?.redactions ?? [], l?.redactions ?? [], r?.redactions ?? []);
    conflicts.push(...regionConflicts);
    doc.redactions = mergedR;
    doc.status = deriveDocStatus(doc);
    docs.push(doc);
  }
  return { docs, conflicts };
}

// ---------- batch merge ----------
function mergeBatches(base: Batch[], local: Batch[], remote: Batch[]): Batch[] {
  const ids = new Set([...base.map((b) => b.id), ...local.map((b) => b.id), ...remote.map((b) => b.id)]);
  const out: Batch[] = [];
  for (const id of ids) {
    const b = base.find((x) => x.id === id);
    const l = local.find((x) => x.id === id);
    const r = remote.find((x) => x.id === id);
    const src = r ?? l ?? b!;
    const bIds = new Set(b?.documentIds ?? []);
    const lIds = new Set(l?.documentIds ?? []);
    const rIds = new Set(r?.documentIds ?? []);
    const mergedIds = new Set<string>();
    for (const x of new Set([...bIds, ...lIds, ...rIds])) {
      const inB = bIds.has(x);
      const inL = lIds.has(x);
      const inR = rIds.has(x);
      if (inB && !inL && !inR) continue;
      if (!inB && !inL && !inR) continue;
      mergedIds.add(x);
    }
    out.push({ ...clone(src), documentIds: [...mergedIds], releaseEligible: false, lastRecalcAt: null });
  }
  return out;
}

// ---------- validation ----------
function validate(docs: DisclosureRecord[], batches: Batch[]) {
  const ids = new Set(docs.map((d) => d.id));
  for (const batch of batches) {
    for (const docId of batch.documentIds) {
      if (!ids.has(docId)) throw new Error(`批次 ${batch.name} 引用了不存在的文档 ${docId}`);
    }
  }
  for (const doc of docs) {
    if (!doc.version || typeof doc.version.major !== 'number' || typeof doc.version.minor !== 'number') {
      throw new Error(`文档 ${doc.id} 缺少版本号`);
    }
    for (const r of doc.redactions) {
      if (r.page < 1 || r.page > doc.pages) throw new Error(`文档 ${doc.id} 区域 ${r.id} 页码越界`);
      if ([r.x, r.y, r.width, r.height].some((v) => v < 0 || v > 1)) throw new Error(`文档 ${doc.id} 区域 ${r.id} 坐标越界`);
    }
  }
}

// ---------- migration ----------
function deriveBatchId(bundle: string): string {
  if (bundle.includes('第一批')) return 'BATCH-01';
  if (bundle.includes('第二批')) return 'BATCH-02';
  return 'BATCH-03';
}

function buildDefaultBatches(documents: DisclosureRecord[]): Batch[] {
  const groups = new Map<string, string[]>();
  for (const d of documents) {
    const bid = d.batchId ?? deriveBatchId(d.bundle);
    if (!groups.has(bid)) groups.set(bid, []);
    groups.get(bid)!.push(d.id);
  }
  const nameMap: Record<string, string> = { 'BATCH-01': '第一批披露', 'BATCH-02': '第二批披露', 'BATCH-03': '专家材料' };
  const statusMap: Record<string, Batch['status']> = { 'BATCH-01': '审阅中', 'BATCH-02': '编制中', 'BATCH-03': '编制中' };
  return ['BATCH-01', 'BATCH-02', 'BATCH-03'].map((id) => ({
    id,
    name: nameMap[id],
    documentIds: groups.get(id) ?? [],
    status: statusMap[id],
    releaseEligible: false,
    lastRecalcAt: null
  }));
}

function migratePersisted(persisted: unknown): PersistedSlice {
  const p = (persisted ?? {}) as Partial<PersistedSlice> & {
    reviewChecks?: ReviewChecks;
    metadataCleaned?: boolean;
  };
  const legacyChecks = p.reviewChecks;
  const legacyMetadata = p.metadataCleaned;
  const rawDocs = Array.isArray(p.documents) ? p.documents : defaultDocuments;
  const documents: DisclosureRecord[] = rawDocs.map((raw) => {
    const legacy = raw as Partial<DisclosureRecord>;
    const passed = legacy.status === '可发布';
    const review: ReviewState = legacy.review
      ? {
          checks: { ...defaultChecks, ...legacy.review.checks },
          metadataCleaned: legacy.review.metadataCleaned ?? false,
          decision: legacy.review.decision ?? 'pending',
          approvedVersion: legacy.review.approvedVersion ?? null
        }
      : {
          checks: { ...defaultChecks, ...(legacyChecks ?? {}) },
          metadataCleaned: legacyMetadata ?? false,
          decision: passed ? 'passed' : 'pending',
          approvedVersion: passed ? legacy.version ?? defaultVersion : null
        };
    const doc: DisclosureRecord = {
      id: legacy.id ?? 'DOC-UNKNOWN',
      title: legacy.title ?? '未命名文档',
      bundle: legacy.bundle ?? '未分组',
      batchId: legacy.batchId ?? deriveBatchId(legacy.bundle ?? ''),
      pages: legacy.pages ?? 1,
      classification: legacy.classification ?? '内部',
      owner: legacy.owner ?? '',
      updatedAt: legacy.updatedAt ?? '',
      status: legacy.status ?? '去密中',
      issue: legacy.issue ?? '',
      size: legacy.size ?? '',
      redactions: Array.isArray(legacy.redactions) ? legacy.redactions : [],
      version: legacy.version ?? defaultVersion,
      review
    };
    doc.status = deriveDocStatus(doc);
    return doc;
  });
  const batches = Array.isArray(p.batches) && p.batches.length ? p.batches : buildDefaultBatches(documents);
  return { documents, batches };
}

// ---------- store ----------
type State = PersistedSlice & {
  activeDocumentId: string;
  activePage: number;
  activeRedactionId: string | null;
  redactionMode: boolean;
  mergeBase: PersistedSlice | null;
  conflicts: Conflict[];
  mergeStatus: MergeStatus;
  mergeError: string | null;
  lastGoodSnapshot: PersistedSlice | null;
  pendingRemote: PersistedSlice | null;
  selectDocument: (id: string) => void;
  setPage: (page: number) => void;
  toggleRedactionMode: () => void;
  addRedaction: (redaction: Omit<Redaction, 'id' | 'status'>) => void;
  confirmRedaction: (id: string) => void;
  selectRedaction: (id: string) => void;
  updateClassification: (classification: DisclosureRecord['classification']) => void;
  toggleReviewCheck: (docId: string, checkId: string) => void;
  toggleMetadata: (docId: string) => void;
  approveDocument: (docId: string) => void;
  rejectDocument: (docId: string) => void;
  adjudicateRegionConflict: (docId: string, regionId: string, choose: 'local' | 'remote') => void;
  adjudicateFieldConflict: (docId: string, field: string, choose: 'local' | 'remote') => void;
  applyRemoteState: (remote: PersistedSlice) => void;
  retryMerge: () => void;
  restoreSnapshot: () => void;
};

function bumpAndReset(d: DisclosureRecord): DisclosureRecord {
  const version = bumpVersion(d.version);
  const review: ReviewState = { ...d.review, decision: 'pending', approvedVersion: null };
  const updated = { ...d, version, review };
  return { ...updated, status: deriveDocStatus(updated) };
}

function bumpConclusion(d: DisclosureRecord): DisclosureRecord {
  const version = bumpVersion(d.version);
  const updated = { ...d, version };
  return { ...updated, status: deriveDocStatus(updated) };
}

export const useDisclosureStore = create<State>()(
  persist(
    (set, get) => ({
      documents: defaultDocuments,
      batches: defaultBatches,
      activeDocumentId: defaultDocuments[0].id,
      activePage: 1,
      activeRedactionId: 'R-02',
      redactionMode: false,
      mergeBase: null,
      conflicts: [],
      mergeStatus: 'idle',
      mergeError: null,
      lastGoodSnapshot: null,
      pendingRemote: null,

      selectDocument: (id) => set({ activeDocumentId: id, activePage: 1, activeRedactionId: null, redactionMode: false }),
      setPage: (page) => set({ activePage: page }),
      toggleRedactionMode: () => set((state) => ({ redactionMode: !state.redactionMode })),
      selectRedaction: (id) => set({ activeRedactionId: id }),

      addRedaction: (redaction) =>
        set((state) => {
          const docs = state.documents.map((d) => {
            if (d.id !== state.activeDocumentId) return d;
            const withNew = { ...d, redactions: [...d.redactions, { ...redaction, id: `R-${Date.now()}`, status: 'draft' as const }] };
            return bumpAndReset(withNew);
          });
          return { documents: docs, batches: recalcBatches(docs, state.batches, gateOpen(state.mergeStatus, state.conflicts)) };
        }),

      confirmRedaction: (id) =>
        set((state) => {
          const docs = state.documents.map((d) => {
            if (!d.redactions.some((r) => r.id === id)) return d;
            const updated = { ...d, redactions: d.redactions.map((r) => (r.id === id ? { ...r, status: 'confirmed' as const } : r)) };
            return bumpAndReset(updated);
          });
          return { documents: docs, batches: recalcBatches(docs, state.batches, gateOpen(state.mergeStatus, state.conflicts)) };
        }),

      updateClassification: (classification) =>
        set((state) => {
          const docs = state.documents.map((d) => (d.id === state.activeDocumentId ? bumpAndReset({ ...d, classification }) : d));
          return { documents: docs, batches: recalcBatches(docs, state.batches, gateOpen(state.mergeStatus, state.conflicts)) };
        }),

      toggleReviewCheck: (docId, checkId) =>
        set((state) => {
          const docs = state.documents.map((d) => {
            if (d.id !== docId) return d;
            const updated: DisclosureRecord = {
              ...d,
              review: { ...d.review, checks: { ...d.review.checks, [checkId]: !d.review.checks[checkId] } }
            };
            return bumpConclusion(updated);
          });
          return { documents: docs, batches: recalcBatches(docs, state.batches, gateOpen(state.mergeStatus, state.conflicts)) };
        }),

      toggleMetadata: (docId) =>
        set((state) => {
          const docs = state.documents.map((d) => {
            if (d.id !== docId) return d;
            const updated: DisclosureRecord = { ...d, review: { ...d.review, metadataCleaned: !d.review.metadataCleaned } };
            return bumpConclusion(updated);
          });
          return { documents: docs, batches: recalcBatches(docs, state.batches, gateOpen(state.mergeStatus, state.conflicts)) };
        }),

      approveDocument: (docId) =>
        set((state) => {
          const docs = state.documents.map((d) => {
            if (d.id !== docId) return d;
            const version = bumpVersion(d.version);
            const review: ReviewState = { ...d.review, decision: 'passed', approvedVersion: version };
            const updated = { ...d, version, review };
            return { ...updated, status: deriveDocStatus(updated) };
          });
          return { documents: docs, batches: recalcBatches(docs, state.batches, gateOpen(state.mergeStatus, state.conflicts)) };
        }),

      rejectDocument: (docId) =>
        set((state) => {
          const docs = state.documents.map((d) => {
            if (d.id !== docId) return d;
            const version = bumpVersion(d.version);
            const review: ReviewState = { ...d.review, decision: 'rejected', approvedVersion: null };
            const updated = { ...d, version, review };
            return { ...updated, status: deriveDocStatus(updated) };
          });
          return { documents: docs, batches: recalcBatches(docs, state.batches, gateOpen(state.mergeStatus, state.conflicts)) };
        }),

      adjudicateRegionConflict: (docId, regionId, choose) =>
        set((state) => {
          const conflict = state.conflicts.find(
            (c): c is RegionConflict => c.kind === 'region' && c.docId === docId && c.regionId === regionId
          );
          if (!conflict) return {};
          const documents = state.documents.map((d) => {
            if (d.id !== docId) return d;
            const chosen = choose === 'local' ? conflict.local : conflict.remote;
            let redactions: Redaction[];
            if (chosen === null) {
              redactions = d.redactions.filter((r) => r.id !== regionId);
            } else {
              redactions = d.redactions.map((r) => (r.id === regionId ? { ...chosen, id: regionId } : r));
            }
            const updated = { ...d, redactions };
            return { ...updated, status: deriveDocStatus(updated) };
          });
          const conflicts = state.conflicts.filter((c) => !(c.kind === 'region' && c.docId === docId && c.regionId === regionId));
          const mergeStatus: MergeStatus = conflicts.length ? 'conflict' : 'idle';
          return { documents, conflicts, mergeStatus, batches: recalcBatches(documents, state.batches, mergeStatus === 'idle') };
        }),

      adjudicateFieldConflict: (docId, field, choose) =>
        set((state) => {
          const conflict = state.conflicts.find(
            (c): c is FieldConflict => c.kind === 'field' && c.docId === docId && c.field === field
          );
          if (!conflict) return {};
          const value = choose === 'local' ? conflict.local : conflict.remote;
          const documents = state.documents.map((d) => (d.id === docId ? setField(d, field, value) : d));
          const conflicts = state.conflicts.filter((c) => !(c.kind === 'field' && c.docId === docId && c.field === field));
          const mergeStatus: MergeStatus = conflicts.length ? 'conflict' : 'idle';
          return { documents, conflicts, mergeStatus, batches: recalcBatches(documents, state.batches, mergeStatus === 'idle') };
        }),

      applyRemoteState: (remoteInput) =>
        set((state) => {
          const snapshot: PersistedSlice = { documents: clone(state.documents), batches: clone(state.batches) };
          try {
            const remote = migratePersisted(remoteInput);
            const base = state.mergeBase ?? { documents: clone(defaultDocuments), batches: clone(defaultBatches) };
            const { docs: mergedDocs, conflicts } = mergeDocuments(base.documents, state.documents, remote.documents);
            const mergedBatches = mergeBatches(base.batches, state.batches, remote.batches);
            validate(mergedDocs, mergedBatches);
            const open = conflicts.length === 0;
            const batches = recalcBatches(mergedDocs, mergedBatches, open);
            return {
              documents: mergedDocs,
              batches,
              conflicts,
              mergeBase: { documents: clone(mergedDocs), batches: clone(batches) },
              mergeStatus: (conflicts.length ? 'conflict' : 'idle') as MergeStatus,
              mergeError: null,
              lastGoodSnapshot: null,
              pendingRemote: null
            };
          } catch (err) {
            return {
              documents: snapshot.documents,
              batches: snapshot.batches,
              mergeStatus: 'failed' as MergeStatus,
              mergeError: err instanceof Error ? err.message : String(err),
              lastGoodSnapshot: snapshot,
              pendingRemote: remoteInput
            };
          }
        }),

      retryMerge: () => {
        const state = get();
        let remote: PersistedSlice | null = state.pendingRemote;
        if (!remote) {
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.state?.documents) remote = migratePersisted(parsed.state);
            }
          } catch {
            /* ignore */
          }
        }
        if (remote) get().applyRemoteState(remote);
      },

      restoreSnapshot: () =>
        set((state) => {
          if (!state.lastGoodSnapshot) return {};
          return {
            documents: clone(state.lastGoodSnapshot.documents),
            batches: clone(state.lastGoodSnapshot.batches),
            mergeStatus: 'idle' as MergeStatus,
            mergeError: null,
            lastGoodSnapshot: null,
            pendingRemote: null
          };
        })
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      migrate: (persisted) => migratePersisted(persisted),
      partialize: (state) => ({
        documents: state.documents,
        batches: state.batches,
        activeDocumentId: state.activeDocumentId,
        activePage: state.activePage,
        activeRedactionId: state.activeRedactionId,
        redactionMode: state.redactionMode
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          useDisclosureStore.setState({
            mergeBase: { documents: clone(state.documents), batches: clone(state.batches) }
          });
        }
      }
    }
  )
);

// ---------- selectors ----------
export function batchBlockers(batch: Batch, documents: DisclosureRecord[], mergeStatus: MergeStatus, conflicts: Conflict[]): string[] {
  const blockers: string[] = [];
  if (mergeStatus === 'failed') blockers.push('合并或重算失败，请先恢复快照或重试');
  if (mergeStatus === 'conflict' || conflicts.length > 0) blockers.push(`存在 ${conflicts.length} 处区域/字段冲突待裁决`);
  for (const id of batch.documentIds) {
    const doc = documents.find((d) => d.id === id);
    if (!doc) {
      blockers.push(`文档 ${id} 缺失`);
      continue;
    }
    if (doc.redactions.some((r) => r.status === 'draft')) blockers.push(`${doc.id} 有未确认去密区域`);
    if (!doc.review.metadataCleaned) blockers.push(`${doc.id} 元数据未清理`);
    if (!reviewCheckDefs.every((c) => doc.review.checks[c.id])) blockers.push(`${doc.id} 质检项未全部完成`);
    if (doc.review.decision !== 'passed') blockers.push(`${doc.id} 复核结论未通过`);
    else if (doc.review.approvedVersion && !deepEqual(doc.review.approvedVersion, doc.version)) {
      blockers.push(`${doc.id} 发布后内容有改动，需重新质检`);
    }
  }
  return blockers;
}
