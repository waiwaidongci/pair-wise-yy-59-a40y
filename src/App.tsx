import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useParams
} from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Eye,
  FileCheck2,
  FileText,
  GitMerge,
  Highlighter,
  History,
  Layers3,
  Lock,
  Menu,
  RefreshCw,
  RotateCcw,
  Save,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Stamp,
  Tags,
  Unlock,
  UploadCloud
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Badge, Button, Card, Dialog, Tabs, X } from './components/ui';
import {
  docStatus,
  statusTone,
  useDisclosureStore,
  type CommitResult,
  type VersionedDocument,
  type VersionedFields
} from './store';
import {
  REVIEW_CHECK_IDS,
  REVIEW_CHECK_LABELS,
  cloneFields,
  diffFields,
  type Classification,
  type PendingConflict,
  type ReviewCheckId
} from './versioning';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const EDITOR_REVIEW = '去密编制';
const EDITOR_QUALITY = '发布质检';

const bundleQuery = async () => ({
  queue: [
    { id: 'Q-31', name: '第三批补充材料', count: 128, owner: '林清', progress: 68, due: '今日 16:00' },
    { id: 'Q-32', name: '证人材料图像件', count: 47, owner: '周叙', progress: 34, due: '明日 11:00' },
    { id: 'Q-33', name: '专家报告附件', count: 19, owner: '顾言', progress: 91, due: '09-30 18:00' }
  ]
});

// ---------- 工作副本：每个标签页各自的未保存草稿，保存时与远端三方合并 ----------

type SaveNotice =
  | { kind: 'committed'; version: number; conflicts: number; fastForwarded: boolean }
  | { kind: 'conflicts'; version: number; count: number }
  | { kind: 'error'; text: string }
  | null;

function useWorkingCopy(docId: string, editor: string) {
  const doc = useDisclosureStore((state) => state.documents.find((item) => item.id === docId));
  const commitEdits = useDisclosureStore((state) => state.commitEdits);
  const [baseVersion, setBaseVersion] = useState(doc?.version ?? 1);
  const [baseFields, setBaseFields] = useState<VersionedFields>(() => cloneFields(doc!.fields));
  const [draft, setDraft] = useState<VersionedFields>(() => cloneFields(doc!.fields));
  const [notice, setNotice] = useState<SaveNotice>(null);
  const docVersion = doc?.version ?? baseVersion;
  const seq = useRef(0);

  // 切换文档时重置工作副本
  useEffect(() => {
    if (!doc) return;
    const token = ++seq.current;
    setBaseVersion(doc.version);
    setBaseFields(cloneFields(doc.fields));
    setDraft(cloneFields(doc.fields));
    setNotice(null);
    return () => {
      seq.current = token;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const patch = (fn: (fields: VersionedFields) => void) => {
    setDraft((current) => {
      const next = cloneFields(current);
      fn(next);
      return next;
    });
  };

  const dirty = useMemo(() => diffFields(baseFields, draft).length > 0, [baseFields, draft]);
  const remoteAhead = doc ? doc.version > baseVersion : false;

  const save = (): CommitResult => {
    if (!doc) return { ok: false, docId, error: '文档不存在' };
    const result = commitEdits({ docId, editor, baseVersion, baseFields, fields: draft });
    if (result.ok) {
      const latest = useDisclosureStore.getState().documents.find((item) => item.id === docId)!;
      setBaseVersion(latest.version);
      setBaseFields(cloneFields(latest.fields));
      setDraft(cloneFields(latest.fields));
      if (result.conflicts.length > 0) {
        setNotice({ kind: 'conflicts', version: result.version, count: result.conflicts.length });
      } else {
        setNotice({ kind: 'committed', version: result.version, conflicts: 0, fastForwarded: result.fastForwarded });
      }
    } else {
      setNotice({ kind: 'error', text: result.error });
    }
    return result;
  };

  // 放弃本地草稿，直接对齐远端最新版本
  const rebase = () => {
    const latest = useDisclosureStore.getState().documents.find((item) => item.id === docId);
    if (!latest) return;
    setBaseVersion(latest.version);
    setBaseFields(cloneFields(latest.fields));
    setDraft(cloneFields(latest.fields));
    setNotice(null);
  };

  return { doc, draft, baseVersion, baseFields, dirty, remoteAhead, notice, setNotice, patch, save, rebase };
}

function VersionBadge({ version, reviewedVersion }: { version: number; reviewedVersion?: number | null }) {
  const stale = reviewedVersion !== undefined && reviewedVersion !== null && reviewedVersion < version;
  return (
    <span className={`version-badge ${stale ? 'stale' : ''}`}>
      v{version}
      {reviewedVersion !== undefined && (
        <small>{reviewedVersion === null ? '复核已失效' : stale ? `复核停留在 v${reviewedVersion}` : `复核 v${reviewedVersion}`}</small>
      )}
    </span>
  );
}

function ConflictCenter({ doc }: { doc: VersionedDocument }) {
  const resolveConflict = useDisclosureStore((state) => state.resolveConflict);
  const retryMerge = useDisclosureStore((state) => state.retryMerge);
  const restoreSnapshot = useDisclosureStore((state) => state.restoreSnapshot);
  if (doc.pendingConflicts.length === 0 && !doc.recovery) return null;
  return (
    <Card className={`conflict-card ${doc.pendingConflicts.length > 0 ? 'has-conflicts' : ''}`}>
      <div className="card-title">
        <GitMerge size={17} />
        <strong>并发合并裁决</strong>
        {doc.pendingConflicts.length > 0 && <Badge tone="red">{doc.pendingConflicts.length} 处待裁决</Badge>}
      </div>
      {doc.recovery && (
        <p className="recovery-note">
          <History size={14} />
          <span>
            已保留「{doc.recovery.editor}」于 {doc.recovery.at} 提交前的可恢复快照
            {doc.recovery.reason ? `（${doc.recovery.reason}）` : ''}。完整合并前，关联批次保持阻塞。
          </span>
        </p>
      )}
      {doc.pendingConflicts.map((conflict) => (
        <ConflictRow key={conflict.id} conflict={conflict} onResolve={(choose) => resolveConflict(doc.id, conflict.id, choose)} />
      ))}
      {doc.recovery && (
        <div className="recovery-actions">
          <Button variant="outline" onClick={() => retryMerge(doc.id)}>
            <RefreshCw size={14} /> 用快照重试合并
          </Button>
          <Button variant="danger" onClick={() => restoreSnapshot(doc.id)}>
            <RotateCcw size={14} /> 回滚到提交前快照
          </Button>
        </div>
      )}
    </Card>
  );
}

function ConflictRow({ conflict, onResolve }: { conflict: PendingConflict; onResolve: (choose: 'mine' | 'theirs') => void }) {
  return (
    <div className="conflict-row">
      <div className="conflict-head">
        <ShieldAlert size={14} />
        <strong>{conflict.label}</strong>
        {conflict.page !== null && <Badge tone="neutral">第 {conflict.page} 页</Badge>}
      </div>
      <div className="conflict-sides">
        <button onClick={() => onResolve('mine')}>
          <small>本方（后保存）</small>
          <b className={conflict.mine.present ? '' : 'deleted'}>{conflict.mine.text}</b>
          <span><Check size={13} /> 采用本方</span>
        </button>
        <button onClick={() => onResolve('theirs')}>
          <small>对方（先保存）</small>
          <b className={conflict.theirs.present ? '' : 'deleted'}>{conflict.theirs.text}</b>
          <span><Check size={13} /> 采用对方</span>
        </button>
      </div>
      {!conflict.bothPresent && <p className="conflict-hint">一侧删除、一侧编辑，两份均保留，裁决前不会静默取舍。</p>}
    </div>
  );
}

function SaveBar({
  working,
  label,
  disabled
}: {
  working: ReturnType<typeof useWorkingCopy>;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="save-bar">
      {working.notice?.kind === 'committed' && (
        <span className="save-note ok">
          <Check size={14} />
          {working.notice.fastForwarded ? `内容无变化，仍为 v${working.notice.version}` : `已保存，版本上调至 v${working.notice.version}`}
        </span>
      )}
      {working.notice?.kind === 'conflicts' && (
        <span className="save-note warn">
          <AlertTriangle size={14} />
          检测到对方已先保存：{working.notice.count} 处同一字段双方都改过，已保留两份等待裁决（v{working.notice.version}）
        </span>
      )}
      {working.notice?.kind === 'error' && (
        <span className="save-note err"><AlertTriangle size={14} /> 合并失败，上一份快照已保留：{working.notice.text}</span>
      )}
      {working.remoteAhead && working.notice?.kind !== 'conflicts' && (
        <span className="save-note warn">
          <GitMerge size={14} />
          另一标签页已保存到 v{working.doc?.version}，你的基线是 v{working.baseVersion}；保存时只合无冲突字段。
          <button className="link-button" onClick={working.rebase}>放弃本地改动并对齐</button>
        </span>
      )}
      {working.dirty && <span className="save-note dirty"><span className="dot" /> 有未保存改动</span>}
      <Button onClick={working.save} disabled={disabled}>
        <Save size={15} /> {label}
      </Button>
    </div>
  );
}

function AppShell() {
  const [mobileNav, setMobileNav] = useState(false);
  const conflicts = useDisclosureStore((state) => state.documents.reduce((sum, doc) => sum + doc.pendingConflicts.length, 0));
  const reviewPending = useDisclosureStore((state) =>
    state.documents.filter((doc) => docStatus(doc) === '待质检' || docStatus(doc) === '去密中').length
  );
  const links = [
    { to: '/', label: '文档集', icon: Layers3 },
    { to: '/review/$documentId', label: '去密审阅', icon: Highlighter, params: { documentId: 'DOC-00418' } },
    { to: '/quality', label: '发布质检', icon: ScanSearch },
    { to: '/batches', label: '批次与标签', icon: Tags }
  ];
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-symbol"><Stamp size={18} /></div>
          <div><strong>披露质控台</strong><span>North Ridge / Litigation Support</span></div>
        </div>
        <div className="top-actions">
          {conflicts > 0 && <Badge tone="red"><GitMerge size={11} /> {conflicts} 处待裁决</Badge>}
          <Badge tone="amber">{reviewPending} 项待质检</Badge>
          <div className="operator"><span>质控员</span><strong>林清 · 审核组</strong></div>
        </div>
        <button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="菜单"><Menu /></button>
      </header>
      <div className="shell-body">
        <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
          <div className="workspace-title">
            <span>当前工作区</span>
            <strong>北岭项目 · 诉讼披露</strong>
          </div>
          <nav>
            {links.map(({ to, label, icon: Icon, params }) => (
              <Link
                key={to}
                to={to as '/'}
                params={params as never}
                activeProps={{ className: 'active' }}
                onClick={() => setMobileNav(false)}
              >
                <Icon size={17} /> <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div><ShieldCheck size={16} /><span>版本化审计记录已开启</span></div>
            <small>草稿自动保存在本机 · 跨标签页实时同步</small>
          </div>
        </aside>
        <main className="main-content"><Outlet /></main>
      </div>
    </div>
  );
}

function DocumentsPage() {
  const documents = useDisclosureStore((state) => state.documents);
  const releasedBatches = useDisclosureStore((state) => state.batches.filter((batch) => batch.releasedAt).length);
  const { data } = useQuery({ queryKey: ['document-queues'], queryFn: bundleQuery });
  const [filter, setFilter] = useState('全部');
  const visible = filter === '全部' ? documents : documents.filter((doc) => docStatus(doc) === filter);
  return (
    <div className="page">
      <header className="page-heading">
        <div><small>DISCLOSURE CONTROL / DOCUMENT SET</small><h1>披露文档集</h1><p>去密区域、密级或复核结论一改动即上调版本，关联批次资格立即失效重算。</p></div>
        <Button><UploadCloud size={16} /> 导入文档集</Button>
      </header>
      <section className="summary-strip">
        <div><span>文档总数</span><strong>{documents.length}</strong><small>示例工作集</small></div>
        <div><span>去密区域</span><strong>{documents.reduce((s, d) => s + d.fields.redactions.length, 0)}</strong><small>随版本索引跟踪</small></div>
        <div><span>待裁决</span><strong className="warning-text">{documents.reduce((s, d) => s + d.pendingConflicts.length, 0)}</strong><small>合并保留两份</small></div>
        <div><span>已批准批次</span><strong>{releasedBatches}</strong><small>资格通过方可发布</small></div>
      </section>
      <div className="two-column">
        <Card className="document-table-card">
          <div className="card-heading">
            <div><Tabs.Root value={filter} onValueChange={setFilter}><Tabs.List className="segmented">
              {['全部', '去密中', '待质检', '待裁决', '可发布'].map((item) => <Tabs.Trigger key={item} value={item}>{item}</Tabs.Trigger>)}
            </Tabs.List></Tabs.Root></div>
            <span>{visible.length} 份文档</span>
          </div>
          <div className="document-table">
            {visible.map((doc) => {
              const status = docStatus(doc);
              return (
                <div className="document-row versioned-row" key={doc.id}>
                  <div className="file-icon"><FileText size={19} /></div>
                  <div className="doc-main">
                    <strong>{doc.title}</strong>
                    <span>{doc.id} · {doc.bundle} · {doc.size}</span>
                  </div>
                  <div className="doc-field"><span>版本</span><VersionBadge version={doc.version} reviewedVersion={doc.fields.review.reviewedVersion} /></div>
                  <div className="doc-field"><span>密级</span><Badge tone={doc.fields.classification === '严格机密' ? 'red' : doc.fields.classification === '机密' ? 'amber' : 'neutral'}>{doc.fields.classification}</Badge></div>
                  <div className="doc-field"><span>状态</span><Badge tone={statusTone(status)}>{status}</Badge></div>
                  <div className="doc-actions">
                    <Link to="/review/$documentId" params={{ documentId: doc.id }}><Button variant="outline">审阅</Button></Link>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <aside className="side-stack">
          <Card className="queue-card">
            <div className="card-title"><ClipboardCheck size={17} /><strong>去密任务队列</strong></div>
            {(data?.queue ?? []).map((item) => (
              <div className="queue-item" key={item.id}>
                <div><strong>{item.name}</strong><span>{item.count} 份 · {item.owner}</span></div>
                <div className="progress"><i style={{ width: `${item.progress}%` }} /></div>
                <small>{item.progress}% · 截止 {item.due}</small>
              </div>
            ))}
          </Card>
          <Card className="audit-card">
            <div className="card-title"><GitMerge size={17} /><strong>版本化协作规则</strong></div>
            <p><b>即时失效</b>去密区域、密级、复核结论任一改动，关联批次发布资格立即重算。</p>
            <p><b>并发合并</b>两个标签页同时编辑时，只合并无冲突字段；同一区域两边都改则保留两份裁决。</p>
            <p><b>旧稿升级</b>无版本号的旧稿回填 v1 索引，原有区域与复核结论保留。</p>
            <p><b>可恢复</b>合并或重算失败保留上一份快照，可重试；完整合并前批次不可发布。</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function useDemoPdf() {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  useEffect(() => {
    let alive = true;
    PDFDocument.create().then(async (pdf) => {
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (let pageNo = 1; pageNo <= 3; pageNo += 1) {
        const page = pdf.addPage([612, 792]);
        page.drawText(`NORTH RIDGE PROJECT - DISCLOSURE EXHIBIT`, { x: 54, y: 728, size: 14, font, color: rgb(0.12, 0.16, 0.2) });
        page.drawText(`Document page ${pageNo} / 3`, { x: 54, y: 704, size: 10, font, color: rgb(0.35, 0.39, 0.43) });
        page.drawLine({ start: { x: 54, y: 690 }, end: { x: 558, y: 690 }, thickness: 1, color: rgb(0.75, 0.78, 0.8) });
        const lines = [
          'Commercial terms and operational records',
          'Parties: North Ridge Equipment Co. and Haiyang Logistics',
          'Reference No. NR-2026-0819 / Confidentiality class: strictly confidential',
          '',
          'The supplier shall provide maintenance records, operating data and',
          'incident reports within ten business days after each quarterly review.',
          '',
          'Contact: [redacted personal information]',
          'Commercial consideration: [redacted third-party quotation]',
          '',
          'This copy is prepared solely for disclosure review. Every marked region',
          'must be confirmed against the original before approval and release.'
        ];
        lines.forEach((line, index) => page.drawText(line, { x: 54, y: 655 - index * 24, size: 10, font, color: rgb(0.1, 0.13, 0.16) }));
        page.drawText(`Control stamp: REVIEW-${String(pageNo).padStart(2, '0')}`, { x: 54, y: 72, size: 9, font, color: rgb(0.5, 0.53, 0.56) });
      }
      return pdf.save();
    }).then((data) => {
      if (alive) {
        const copy = new Uint8Array(data);
        setBytes(copy.buffer as ArrayBuffer);
      }
    });
    return () => { alive = false; };
  }, []);
  return bytes;
}

function PdfPage({ pageNumber, redacted = false, onDraw }: { pageNumber: number; redacted?: boolean; onDraw?: (region: { x: number; y: number; width: number; height: number }) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bytes = useDemoPdf();
  const [drawing, setDrawing] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const start = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!bytes || !canvasRef.current) return;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    const render = async () => {
      task = pdfjs.getDocument({ data: bytes.slice(0) });
      const pdf = await task.promise;
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.25 });
      const canvas = canvasRef.current!;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = viewport.width * ratio;
      canvas.height = viewport.height * ratio;
      canvas.style.width = '100%';
      canvas.style.aspectRatio = `${viewport.width}/${viewport.height}`;
      const context = canvas.getContext('2d')!;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
    };
    render().catch(console.error);
    return () => { task?.destroy(); };
  }, [bytes, pageNumber]);

  const pointerDown = (event: React.PointerEvent) => {
    if (!onDraw) return;
    const rect = event.currentTarget.getBoundingClientRect();
    start.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setDrawing({ x: start.current.x / rect.width, y: start.current.y / rect.height, width: 0, height: 0 });
  };
  const pointerMove = (event: React.PointerEvent) => {
    if (!drawing || !onDraw) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(start.current.x, event.clientX - rect.left) / rect.width;
    const y = Math.min(start.current.y, event.clientY - rect.top) / rect.height;
    const width = Math.abs(event.clientX - rect.left - start.current.x) / rect.width;
    const height = Math.abs(event.clientY - rect.top - start.current.y) / rect.height;
    setDrawing({ x, y, width, height });
  };
  const pointerUp = () => {
    if (drawing && onDraw && drawing.width > 0.015 && drawing.height > 0.01) onDraw(drawing);
    setDrawing(null);
  };
  return (
    <div className={`pdf-page ${onDraw ? 'drawable' : ''}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>
      <canvas ref={canvasRef} />
      {redacted && <div className="page-redaction-demo"><span>已发布区域掩码</span></div>}
      {drawing && <i className="drawing-region" style={{ left: `${drawing.x * 100}%`, top: `${drawing.y * 100}%`, width: `${drawing.width * 100}%`, height: `${drawing.height * 100}%` }} />}
    </div>
  );
}

function ReviewPage() {
  const { documentId } = useParams({ from: '/review/$documentId' });
  const navigate = useNavigate();
  const store = useDisclosureStore();
  const { activePage, redactionMode, activeRedactionId } = store;
  const working = useWorkingCopy(documentId, EDITOR_REVIEW);
  const doc = working.doc!;
  const draft = working.draft;
  const pageRegions = draft.redactions.filter((item) => item.page === activePage);
  const active = draft.redactions.find((item) => item.id === activeRedactionId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState('商业秘密');
  const [privilege, setPrivilege] = useState('合同保密');

  const addRegion = (region: { x: number; y: number; width: number; height: number }) => {
    working.patch((fields) => {
      fields.redactions.push({ ...region, page: activePage, reason, privilege, id: `R-${Date.now()}`, status: 'draft' });
    });
  };
  const confirmRegion = (id: string) => {
    working.patch((fields) => {
      const target = fields.redactions.find((item) => item.id === id);
      if (target) target.status = 'confirmed';
    });
  };
  const submitToQuality = () => {
    const result = working.save();
    if (result.ok) navigate({ to: '/quality' });
  };

  return (
    <div className="page review-page">
      <header className="review-header">
        <div className="review-title">
          <Button variant="ghost" onClick={() => navigate({ to: '/' })}><ArrowLeft size={16} /></Button>
          <div><small>{doc.id} / 去密审阅 / {EDITOR_REVIEW}</small><h1>{doc.title}</h1></div>
          <Badge tone={doc.fields.classification === '严格机密' ? 'red' : 'amber'}>{draft.classification}</Badge>
          <VersionBadge version={doc.version} />
          {doc.pendingConflicts.length > 0 && <Badge tone="red"><GitMerge size={11} /> 待裁决 {doc.pendingConflicts.length}</Badge>}
        </div>
        <div className="review-actions">
          <Button variant="outline" onClick={() => store.toggleRedactionMode()} className={redactionMode ? 'active-button' : ''}><Highlighter size={16} /> {redactionMode ? '取消绘制' : '绘制去密区'}</Button>
          <Button variant="outline" onClick={() => setDialogOpen(true)}><FileCheck2 size={16} /> 发布前校验</Button>
          <Button onClick={submitToQuality}><Check size={16} /> 保存并提交质检</Button>
        </div>
      </header>
      <div className="collab-strip">
        <SaveBar working={working} label="保存去密稿（版本上调）" />
      </div>
      <div className="review-layout">
        <aside className="page-thumbs">
          <div className="side-label">页级预览 <span>{doc.pages} 页</span></div>
          {[1, 2, 3].map((page) => (
            <button key={page} className={activePage === page ? 'active' : ''} onClick={() => store.setPage(page)}>
              <div className="mini-page"><span>{page}</span><i style={{ width: `${45 + page * 9}%` }} /><i style={{ width: `${70 - page * 5}%` }} /><i style={{ width: `${55 + page * 4}%` }} /></div>
              <small>第 {page} 页</small>
            </button>
          ))}
        </aside>
        <section className="viewer-column">
          <div className="viewer-toolbar">
            <div><button onClick={() => store.setPage(Math.max(1, activePage - 1))} disabled={activePage === 1}><ChevronLeft size={16} /></button><strong>{activePage} / {doc.pages}</strong><button onClick={() => store.setPage(Math.min(doc.pages, activePage + 1))} disabled={activePage === doc.pages}><ChevronRight size={16} /></button></div>
            <span>125%</span>
            <span>原页 · 掩码叠加</span>
          </div>
          <div className="pdf-stage">
            <PdfPage
              pageNumber={activePage}
              onDraw={redactionMode ? addRegion : undefined}
            />
            {pageRegions.map((region) => (
              <button
                key={region.id}
                className={`redaction-region ${region.status} ${activeRedactionId === region.id ? 'selected' : ''}`}
                style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}
                onClick={() => store.selectRedaction(region.id)}
                title={`${region.reason} / ${region.privilege}`}
              />
            ))}
          </div>
        </section>
        <aside className="inspector">
          <div className="side-label">区域属性</div>
          {active ? (
            <>
              <div className="inspector-title"><strong>{active.reason}</strong><Badge tone={active.status === 'confirmed' ? 'green' : 'amber'}>{active.status === 'confirmed' ? '已确认' : '草稿'}</Badge></div>
              <label>保密级别<select value={draft.classification} onChange={(event) => working.patch((fields) => { fields.classification = event.target.value as Classification; })}><option>内部</option><option>机密</option><option>严格机密</option></select></label>
              <label>去密原因<input value={active.reason} readOnly /></label>
              <label>特权标签<input value={active.privilege} readOnly /></label>
              <label>责任人员<input value={doc.owner} readOnly /></label>
              <div className="coordinate-grid"><div><span>X</span><b>{Math.round(active.x * 100)}%</b></div><div><span>Y</span><b>{Math.round(active.y * 100)}%</b></div><div><span>宽</span><b>{Math.round(active.width * 100)}%</b></div><div><span>高</span><b>{Math.round(active.height * 100)}%</b></div></div>
              <Button onClick={() => confirmRegion(active.id)} disabled={active.status === 'confirmed'}><Check size={15} /> 确认此区域</Button>
              <Button variant="outline"><Copy size={15} /> 批量复制到同类页</Button>
            </>
          ) : <p className="muted">在文档页面上选择一个去密区域查看属性。密级改动会作为受控字段参与版本合并。</p>}
          <div className="rule-note"><AlertTriangle size={16} /><span>保存后版本上调，关联批次发布资格立即失效重算；旧版本文档不能通过批次门禁。</span></div>
          <ConflictCenter doc={doc} />
        </aside>
      </div>
      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>发布前校验</Dialog.Title>
            <Dialog.Description>系统将核对原始页与发布页的一致性，并检查元数据残留。校验结论同样参与版本合并。</Dialog.Description>
            <div className="dialog-checks">
              <p><Check /> {draft.redactions.length} 个去密区域已定位</p>
              <p><Check /> 文档版本 v{doc.version} 与操作者记录完整</p>
              <p className={draft.redactions.some((item) => item.status === 'draft') ? 'failed' : ''}><AlertTriangle /> {draft.redactions.some((item) => item.status === 'draft') ? '仍有未确认区域' : '所有区域已确认'}</p>
              {doc.pendingConflicts.length > 0 && <p className="failed"><GitMerge /> {doc.pendingConflicts.length} 处并发冲突待裁决，完整合并前不可发布</p>}
            </div>
            <Dialog.Close asChild><Button>返回检查 <X size={15} /></Button></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function QualityPage() {
  const documents = useDisclosureStore((state) => state.documents);
  const [selectedId, setSelectedId] = useState(documents[1]?.id ?? documents[0].id);
  const working = useWorkingCopy(selectedId, EDITOR_QUALITY);
  const doc = working.doc!;
  const draft = working.draft;
  const checks = REVIEW_CHECK_IDS.map((id) => ({ id, label: REVIEW_CHECK_LABELS[id] }));
  const allChecksPass = REVIEW_CHECK_IDS.every((id) => draft.review.checks[id]);

  const toggleCheck = (id: ReviewCheckId) => {
    working.patch((fields) => {
      fields.review.checks[id] = !fields.review.checks[id];
      // 任一项变动都使旧通过结论失效，需要重新通过
      fields.review.approved = false;
      fields.review.reviewer = '';
      fields.review.reviewedAt = null;
    });
  };
  const approve = () => {
    working.patch((fields) => {
      fields.review.checks = { 'forbidden-terms': true, 'page-number': true, 'image-boundary': true, metadata: true };
      fields.review.approved = true;
      fields.review.reviewer = EDITOR_QUALITY;
      fields.review.reviewedAt = new Date().toLocaleString('zh-CN', { hour12: false });
      // 置空旧盖章以表达“对当前内容重新复核”；保存后由 store 按新版本号落定
      fields.review.reviewedVersion = null;
    });
    working.save();
  };

  return (
    <div className="page">
      <header className="page-heading">
        <div><small>QUALITY ASSURANCE / SIDE-BY-SIDE</small><h1>发布质检双人复核</h1><p>复核结论与去密稿版本化协作：任一区域或密级变化，结论立即过期、批次资格重算。</p></div>
        <Button><FileCheck2 size={16} /> 导出发布清单</Button>
      </header>
      <div className="quality-doc-switch">
        <span>复核文档</span>
        <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          {documents.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.title}（v{item.version}）</option>)}
        </select>
        <VersionBadge version={doc.version} reviewedVersion={doc.fields.review.reviewedVersion} />
        <Badge tone={statusTone(docStatus(doc))}>{docStatus(doc)}</Badge>
      </div>
      <div className="comparison-banner">
        <div><Eye size={17} /><strong>{doc.title}</strong><span>版本 v{doc.version} · {EDITOR_QUALITY} 工作副本基线 v{working.baseVersion}</span></div>
        <div className="banner-badges">
          {doc.fields.review.approved && doc.fields.review.reviewedVersion === doc.version && <Badge tone="green">复核通过</Badge>}
          {doc.fields.review.approved && doc.fields.review.reviewedVersion !== doc.version && <Badge tone="amber">结论已过期，需重新复核</Badge>}
          {doc.pendingConflicts.length > 0 && <Badge tone="red"><GitMerge size={11} /> {doc.pendingConflicts.length} 处待裁决</Badge>}
        </div>
      </div>
      <div className="compare-grid">
        <Card className="compare-panel"><div className="compare-head"><span>原始页</span><Badge tone="neutral">源文件</Badge></div><div className="compare-page"><PdfPage pageNumber={1} /></div></Card>
        <Card className="compare-panel"><div className="compare-head"><span>发布页</span><Badge tone="green">已遮蔽</Badge></div><div className="compare-page redacted-preview"><PdfPage pageNumber={1} redacted /><div className="demo-mask mask-one" /><div className="demo-mask mask-two" /></div></Card>
      </div>
      <div className="quality-bottom">
        <div className="quality-left-stack">
          <Card className="checks-card">
            <div className="card-title"><ClipboardCheck size={17} /><strong>发布前校验项</strong></div>
            {checks.map((check) => (
              <button className="check-row" key={check.id} onClick={() => toggleCheck(check.id)}>
                <span className={draft.review.checks[check.id] ? 'checked' : ''}>{draft.review.checks[check.id] && <Check size={13} />}</span>
                <div><strong>{check.label}</strong><small>勾选即改动复核字段，保存后版本上调</small></div>
              </button>
            ))}
          </Card>
          <div className="collab-strip quality-strip"><SaveBar working={working} label="保存复核结论" /></div>
        </div>
        <div className="quality-right-stack">
          <Card className="decision-card">
            <div className="card-title"><ShieldCheck size={17} /><strong>复核结论</strong></div>
            <p>当前工作副本有 <b>{draft.redactions.length}</b> 个去密区域，其中已确认 {draft.redactions.filter((item) => item.status === 'confirmed').length} 个。</p>
            {doc.fields.review.reviewedVersion !== null && doc.fields.review.reviewedVersion < doc.version && (
              <p className="stale-review"><AlertTriangle size={14} /> 结论针对 v{doc.fields.review.reviewedVersion}，文档已升至 v{doc.version}，旧结论不能放行。</p>
            )}
            <label className="approval-line"><input type="checkbox" checked={draft.review.approved} readOnly /> 复核通过（勾选全部校验项后可提交）</label>
            <div className="decision-actions">
              <Button variant="outline"><ArrowLeft size={15} /> 退回补件</Button>
              <Button disabled={!allChecksPass || doc.pendingConflicts.length > 0} onClick={approve}><Check size={15} /> 通过并保存结论</Button>
            </div>
          </Card>
          <ConflictCenter doc={doc} />
        </div>
      </div>
    </div>
  );
}

function EligibilityPanel({ batch }: { batch: ReturnType<typeof useDisclosureStore.getState>['batches'][number] }) {
  const recompute = useDisclosureStore((state) => state.recomputeBatch);
  const release = useDisclosureStore((state) => state.releaseBatch);
  const armFailure = useDisclosureStore((state) => state.armRecomputeFailure);
  const eligibility = batch.eligibility;
  return (
    <Card className="eligibility-card">
      <div className="card-title">
        {eligibility?.status === 'publishable' ? <ShieldCheck size={17} /> : <Lock size={17} />}
        <strong>发布资格</strong>
        {eligibility && <Badge tone={eligibility.status === 'publishable' ? 'green' : 'red'}>{eligibility.status === 'publishable' ? '可发布' : '阻塞'}</Badge>}
      </div>
      <p className="eligibility-meta">
        资格版本 E{eligibility?.eligibilityVersion ?? 0} · {eligibility?.computedAt ?? '尚未重算'}
        {batch.releasedAt && <span className="released-tag">已于 {batch.releasedAt} 发布</span>}
      </p>
      {batch.recomputeError && (
        <div className="eligibility-error">
          <div><Siren size={15} /><span>{batch.recomputeError}</span></div>
          <Button variant="outline" onClick={() => recompute(batch.id)}><RefreshCw size={14} /> 重试重算</Button>
        </div>
      )}
      {eligibility && eligibility.reasons.length > 0 && (
        <ul className="eligibility-reasons">
          {eligibility.reasons.map((reason, index) => (
            <li key={`${reason.code}-${'docId' in reason ? reason.docId : 'batch'}-${index}`}>
              <AlertTriangle size={13} />
              <span>{'docId' in reason ? `${reason.docId}：` : ''}{reason.text}</span>
            </li>
          ))}
        </ul>
      )}
      {eligibility?.status === 'publishable' && !batch.recomputeError && (
        <p className="eligibility-ok"><Check size={14} /> 全部成员文档版本与复核结论一致，完整合并已完成。</p>
      )}
      <div className="eligibility-actions">
        <Button variant="outline" onClick={() => recompute(batch.id)}><RefreshCw size={14} /> 立即重算</Button>
        <Button disabled={eligibility?.status !== 'publishable' || Boolean(batch.recomputeError)} onClick={() => release(batch.id)}><Unlock size={14} /> {batch.releasedAt ? '再次标记发布' : '标记批次可发布'}</Button>
      </div>
      <button className="drill-button" onClick={() => { armFailure(); recompute(batch.id); }}>
        <Siren size={12} /> 演练：下一次重算失败（验证快照保留与重试）
      </button>
    </Card>
  );
}

function BatchesPage() {
  const documents = useDisclosureStore((state) => state.documents);
  const batches = useDisclosureStore((state) => state.batches);
  const saveBatch = useDisclosureStore((state) => state.saveBatch);
  const [activeBatchId, setActiveBatchId] = useState(batches[0].id);
  const batch = batches.find((item) => item.id === activeBatchId) ?? batches[0];
  const [selected, setSelected] = useState<string[]>(batch.memberIds);
  const [tags, setTags] = useState<string[]>(batch.tags);
  const [note, setNote] = useState(batch.exportNote);
  const [savedHint, setSavedHint] = useState(false);

  useEffect(() => {
    setSelected(batch.memberIds);
    setTags(batch.tags);
    setNote(batch.exportNote);
    setSavedHint(false);
  }, [batch.id, batch.memberIds, batch.tags, batch.exportNote]);

  const allTagOptions = ['合同问题', '设备缺陷', '现场安全', '损害赔偿', '仅律师可见'];
  const toggleMember = (id: string) => setSelected((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  const toggleTag = (tag: string) => setTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
  const persistBatch = () => {
    saveBatch(batch.id, { memberIds: selected, tags, exportNote: note });
    setSavedHint(true);
  };

  const totalPages = selected.reduce((sum, id) => sum + (documents.find((doc) => doc.id === id)?.pages ?? 0), 0);
  const blockingDocs = documents.filter((doc) => selected.includes(doc.id) && docStatus(doc) !== '可发布');
  const conflictCount = documents.reduce((sum, doc) => sum + (selected.includes(doc.id) ? doc.pendingConflicts.length : 0), 0);

  return (
    <div className="page">
      <header className="page-heading"><div><small>RELEASE BATCH / TAXONOMY</small><h1>发布批次与标签</h1><p>批次资格按成员文档版本指纹计算；文档一升级，旧资格立即失效并重算。</p></div><Button onClick={persistBatch}>保存批次设置</Button></header>
      <div className="batch-layout">
        <Card className="batch-list">
          <div className="card-title"><Layers3 size={17} /><strong>发布批次</strong></div>
          {batches.map((item) => (
            <button key={item.id} className={item.id === batch.id ? 'active' : ''} onClick={() => setActiveBatchId(item.id)}>
              <span>{item.id} · E{item.eligibility?.eligibilityVersion ?? 0}</span>
              <strong>{item.name}</strong>
              <small>
                {item.memberIds.length} 份文档 ·{' '}
                {item.recomputeError ? '重算失败（保留旧快照）' : item.eligibility?.status === 'publishable' ? '资格通过' : '资格阻塞'}
              </small>
            </button>
          ))}
        </Card>
        <Card className="batch-content">
          <div className="card-title"><Tags size={17} /><strong>文档与案件问题映射</strong><span>{selected.length} 已选择</span></div>
          <div className="batch-table">
            {documents.map((doc) => {
              const status = docStatus(doc);
              return (
                <label key={doc.id} className="batch-row">
                  <input type="checkbox" checked={selected.includes(doc.id)} onChange={() => toggleMember(doc.id)} />
                  <FileText size={17} />
                  <div><strong>{doc.title}</strong><span>{doc.id} · {doc.issue}</span></div>
                  <VersionBadge version={doc.version} reviewedVersion={doc.fields.review.reviewedVersion} />
                  <Badge tone={statusTone(status)}>{status}</Badge>
                </label>
              );
            })}
          </div>
          <div className="tag-editor">
            <h3>标签与分发级</h3>
            <div className="tag-options">{allTagOptions.map((tag) => (
              <span key={tag} className={tags.includes(tag) ? 'selected' : ''} onClick={() => toggleTag(tag)}>{tag}</span>
            ))}</div>
            <label>导出清单说明<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <div className="tag-actions">
              <Button onClick={persistBatch}><Save size={15} /> 保存批次设置并重算资格</Button>
              {savedHint && <span className="save-note ok"><Check size={14} /> 已保存，资格按最新成员版本重算</span>}
            </div>
          </div>
        </Card>
        <div className="batch-side">
          <EligibilityPanel batch={batch} />
          <Card className="batch-summary">
            <div className="side-label">当前批次摘要</div>
            <strong>{batch.name}</strong>
            <dl>
              <div><dt>文档</dt><dd>{selected.length}</dd></div>
              <div><dt>页数</dt><dd>{totalPages}</dd></div>
              <div><dt>阻塞文档</dt><dd className={blockingDocs.length ? 'warning-text' : ''}>{blockingDocs.length}</dd></div>
              <div><dt>待裁决</dt><dd className={conflictCount ? 'warning-text' : ''}>{conflictCount}</dd></div>
            </dl>
            <div className="summary-note"><AlertTriangle size={15} /><span>{conflictCount > 0 ? '存在待裁决冲突，完整合并前批次保持阻塞。' : blockingDocs.length > 0 ? '发布前仍需完成版本复核与去密确认。' : '资格已通过，可以标记发布。'}</span></div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const rootRoute = createRootRoute({ component: AppShell });
const documentsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DocumentsPage });
const reviewRoute = createRoute({ getParentRoute: () => rootRoute, path: '/review/$documentId', component: ReviewPage });
const qualityRoute = createRoute({ getParentRoute: () => rootRoute, path: '/quality', component: QualityPage });
const batchesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/batches', component: BatchesPage });
const routeTree = rootRoute.addChildren([documentsRoute, reviewRoute, qualityRoute, batchesRoute]);
const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

export default function App() {
  return <RouterProvider router={router} />;
}
