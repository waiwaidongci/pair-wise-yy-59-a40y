// Logic test for versioning + three-way merge + migration.
// Run with: npx tsx src/store.test.ts
import { useDisclosureStore, STORAGE_KEY, type PersistedSlice } from './store';

declare const process: { exit(code?: number): void };

// ---- mock localStorage ----
const storeMap = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => storeMap.get(key) ?? null,
  setItem: (key: string, value: string) => { storeMap.set(key, value); },
  removeItem: (key: string) => { storeMap.delete(key); },
  clear: () => storeMap.clear(),
  key: (i: number) => [...storeMap.keys()][i] ?? null,
  length: storeMap.size
};

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed += 1; console.log(`  ✓ ${msg}`); }
  else { failed += 1; console.error(`  ✗ ${msg}`); }
}

function reset() {
  storeMap.clear();
  useDisclosureStore.setState({
    documents: undefined as never,
    batches: undefined as never,
    mergeBase: null,
    conflicts: [],
    mergeStatus: 'idle',
    mergeError: null,
    lastGoodSnapshot: null,
    pendingRemote: null
  });
  // re-seed defaults by re-importing is hard; instead reset to defaults via a fresh module load
}

// We need a fresh store per scenario. Since the module is a singleton, we reset state manually.
function freshStore() {
  const s = useDisclosureStore.getState();
  // reset to defaults by reloading from the module's defaults is not exposed;
  // instead we clear localStorage and reload via a dynamic import cache bust.
  storeMap.clear();
  // Force rehydrate: zustand persist reads localStorage on creation only.
  // So we directly set a clean default state.
  const defaults = JSON.parse(JSON.stringify({
    documents: [
      {
        id: 'DOC-00418', title: '设备采购补充协议（第三版）', bundle: '北岭项目 · 第一批披露', batchId: 'BATCH-01',
        pages: 3, classification: '严格机密', owner: '林清', updatedAt: '09:48', status: '去密中',
        issue: '合同主体与商业条款', size: '8.4 MB', version: { major: 1, minor: 0 },
        review: { checks: { 'forbidden-terms': false, 'page-number': false, 'image-boundary': false, 'metadata': false }, metadataCleaned: false, decision: 'pending', approvedVersion: null },
        redactions: [
          { id: 'R-01', page: 1, x: 0.12, y: 0.16, width: 0.30, height: 0.04, reason: '商业秘密', privilege: '合同保密', status: 'confirmed' },
          { id: 'R-02', page: 1, x: 0.50, y: 0.43, width: 0.34, height: 0.06, reason: '个人手机号', privilege: '个人信息', status: 'draft' },
          { id: 'R-03', page: 2, x: 0.11, y: 0.25, width: 0.68, height: 0.05, reason: '第三方报价', privilege: '商业敏感', status: 'confirmed' }
        ]
      },
      {
        id: 'DOC-00427', title: '现场会议纪要 2026-08-19', bundle: '北岭项目 · 第一批披露', batchId: 'BATCH-01',
        pages: 3, classification: '机密', owner: '周叙', updatedAt: '09:31', status: '待质检',
        issue: '事故预防与整改安排', size: '3.1 MB', version: { major: 1, minor: 0 },
        review: { checks: { 'forbidden-terms': false, 'page-number': false, 'image-boundary': false, 'metadata': false }, metadataCleaned: false, decision: 'pending', approvedVersion: null },
        redactions: [
          { id: 'R-04', page: 1, x: 0.08, y: 0.69, width: 0.74, height: 0.05, reason: '内部调查意见', privilege: '工作成果', status: 'confirmed' }
        ]
      }
    ],
    batches: [
      { id: 'BATCH-01', name: '第一批披露', documentIds: ['DOC-00418', 'DOC-00427'], status: '审阅中', releaseEligible: false, lastRecalcAt: null },
      { id: 'BATCH-02', name: '第二批披露', documentIds: [], status: '编制中', releaseEligible: false, lastRecalcAt: null }
    ],
    activeDocumentId: 'DOC-00418', activePage: 1, activeRedactionId: 'R-02', redactionMode: false,
    mergeBase: null, conflicts: [], mergeStatus: 'idle', mergeError: null, lastGoodSnapshot: null, pendingRemote: null
  }));
  useDisclosureStore.setState(defaults);
  useDisclosureStore.setState({ mergeBase: { documents: JSON.parse(JSON.stringify(defaults.documents)), batches: JSON.parse(JSON.stringify(defaults.batches)) } });
  return useDisclosureStore.getState();
}

console.log('Scenario 1: content change bumps version + invalidates batch');
{
  const s = freshStore();
  const before = s.documents.find((d) => d.id === 'DOC-00418')!.version;
  s.updateClassification('机密');
  const after = useDisclosureStore.getState().documents.find((d) => d.id === 'DOC-00418')!;
  assert(after.version.minor === before.minor + 1, `version bumped ${before.minor} -> ${after.version.minor}`);
  assert(after.review.decision === 'pending', 'decision reset to pending');
  const batch = useDisclosureStore.getState().batches.find((b) => b.id === 'BATCH-01')!;
  assert(batch.releaseEligible === false, 'batch release eligibility invalidated');
  assert(batch.status === '审阅中', 'never-eligible batch stays 审阅中 (nothing to revoke)');
}

console.log('Scenario 2: approve makes batch eligible (all docs pass)');
{
  const s = freshStore();
  // approve both docs: set all checks + metadata + approve
  for (const id of ['DOC-00418', 'DOC-00427']) {
    for (const c of ['forbidden-terms', 'page-number', 'image-boundary', 'metadata']) s.toggleReviewCheck(id, c);
    s.toggleMetadata(id);
    // confirm draft regions
    const doc = useDisclosureStore.getState().documents.find((d) => d.id === id)!;
    for (const r of doc.redactions.filter((x) => x.status === 'draft')) s.confirmRedaction(r.id);
    s.approveDocument(id);
  }
  const batch = useDisclosureStore.getState().batches.find((b) => b.id === 'BATCH-01')!;
  assert(batch.releaseEligible === true, 'batch release eligible after all docs approved');
  assert(batch.status === '可发布', 'batch status 可发布');
}

console.log('Scenario 3: post-approval change invalidates (version mismatch)');
{
  const s = freshStore();
  for (const id of ['DOC-00418', 'DOC-00427']) {
    for (const c of ['forbidden-terms', 'page-number', 'image-boundary', 'metadata']) s.toggleReviewCheck(id, c);
    s.toggleMetadata(id);
    const doc = useDisclosureStore.getState().documents.find((d) => d.id === id)!;
    for (const r of doc.redactions.filter((x) => x.status === 'draft')) s.confirmRedaction(r.id);
    s.approveDocument(id);
  }
  // now change a redaction on DOC-00418
  s.addRedaction({ page: 2, x: 0.2, y: 0.2, width: 0.1, height: 0.1, reason: '新区域', privilege: '商业秘密' });
  const batch = useDisclosureStore.getState().batches.find((b) => b.id === 'BATCH-01')!;
  assert(batch.releaseEligible === false, 'batch invalidated after post-approval change');
  assert(batch.status === '已失效', 'batch status 已失效');
}

console.log('Scenario 4: non-conflicting remote field merges');
{
  const s = freshStore();
  // remote changes DOC-00427 classification (local did not touch it)
  const remote: PersistedSlice = {
    documents: JSON.parse(JSON.stringify(useDisclosureStore.getState().documents)).map((d: { id: string; classification: string }) =>
      d.id === 'DOC-00427' ? { ...d, classification: '严格机密' } : d
    ),
    batches: JSON.parse(JSON.stringify(useDisclosureStore.getState().batches))
  };
  s.applyRemoteState(remote);
  const state = useDisclosureStore.getState();
  assert(state.mergeStatus === 'idle', 'merge status idle');
  assert(state.conflicts.length === 0, 'no conflicts');
  assert(state.documents.find((d) => d.id === 'DOC-00427')!.classification === '严格机密', 'remote classification merged');
}

console.log('Scenario 5: same-region both-edited keeps two copies (conflict)');
{
  const s = freshStore();
  // local edits R-01 reason
  const local = useDisclosureStore.getState().documents;
  const localDoc = local.find((d) => d.id === 'DOC-00418')!;
  const localEdited = { ...localDoc, redactions: localDoc.redactions.map((r) => r.id === 'R-01' ? { ...r, reason: '本侧修改的原因' } : r) };
  // remote edits R-01 differently
  const remoteDoc = JSON.parse(JSON.stringify(localDoc));
  remoteDoc.redactions = remoteDoc.redactions.map((r: { id: string; reason: string }) => r.id === 'R-01' ? { ...r, reason: '另一侧修改的原因' } : r);
  // set local state to localEdited (so local differs from base)
  useDisclosureStore.setState({ documents: local.map((d) => d.id === 'DOC-00418' ? localEdited : d) });
  s.applyRemoteState({ documents: [remoteDoc, ...local.filter((d) => d.id !== 'DOC-00418')], batches: JSON.parse(JSON.stringify(useDisclosureStore.getState().batches)) });
  const state = useDisclosureStore.getState();
  assert(state.mergeStatus === 'conflict', 'merge status conflict');
  assert(state.conflicts.length === 1, `one conflict (got ${state.conflicts.length})`);
  assert(state.conflicts[0].kind === 'region', 'conflict is region kind');
  // both copies retained
  const c = state.conflicts[0] as { local: { reason: string } | null; remote: { reason: string } | null };
  assert(c.local?.reason === '本侧修改的原因', 'local copy retained');
  assert(c.remote?.reason === '另一侧修改的原因', 'remote copy retained');
  // batch blocked
  const batch = state.batches.find((b) => b.id === 'BATCH-01')!;
  assert(batch.releaseEligible === false, 'batch blocked during conflict');
  // adjudicate: choose local
  s.adjudicateRegionConflict('DOC-00418', 'R-01', 'local');
  const after = useDisclosureStore.getState();
  assert(after.conflicts.length === 0, 'conflict resolved after adjudication');
  assert(after.mergeStatus === 'idle', 'merge idle after adjudication');
  assert(after.documents.find((d) => d.id === 'DOC-00418')!.redactions.find((r) => r.id === 'R-01')!.reason === '本侧修改的原因', 'local version adopted');
}

console.log('Scenario 6: migration backfills version + preserves redactions and review');
{
  storeMap.clear();
  // old-shape persisted state (no version, no batchId, global reviewChecks)
  const oldState = {
    state: {
      documents: [
        { id: 'DOC-OLD', title: '旧稿', bundle: '北岭项目 · 第一批披露', pages: 2, classification: '机密', owner: '周叙', updatedAt: '09:00', status: '可发布', issue: 'x', size: '1 MB', redactions: [{ id: 'R-99', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.2, reason: '旧区域', privilege: 'x', status: 'confirmed' }] }
      ],
      batches: [],
      reviewChecks: { 'forbidden-terms': true, 'page-number': true, 'image-boundary': false, metadata: false },
      metadataCleaned: false,
      activeDocumentId: 'DOC-OLD', activePage: 1, activeRedactionId: null, redactionMode: false
    },
    version: 1
  };
  storeMap.set(STORAGE_KEY, JSON.stringify(oldState));
  // Recreate the store to trigger rehydrate is hard (singleton). Instead call migratePersisted via a storage event path.
  // We simulate by directly invoking the migrate function through applyRemoteState.
  const s = useDisclosureStore.getState();
  // @ts-expect-error testing migration via applyRemoteState with old-shape input
  s.applyRemoteState(oldState.state);
  const state = useDisclosureStore.getState();
  const doc = state.documents.find((d) => d.id === 'DOC-OLD')!;
  assert(doc.version !== undefined && typeof doc.version.major === 'number', 'version backfilled');
  assert(doc.redactions.length === 1 && doc.redactions[0].reason === '旧区域', 'redactions preserved');
  assert(doc.review.checks['forbidden-terms'] === true, 'review conclusion preserved');
  assert(doc.batchId === 'BATCH-01', 'batchId derived');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
