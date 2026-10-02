import { useEffect, useRef, useState } from 'react';
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
  Menu,
  PanelLeftClose,
  RotateCw,
  Scale,
  ScanSearch,
  ShieldCheck,
  Stamp,
  Tags,
  UploadCloud,
  X
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Badge, Button, Card, Dialog, Tabs } from './components/ui';
import {
  STORAGE_KEY,
  batchBlockers,
  formatVersion,
  reviewCheckDefs,
  useDisclosureStore,
  type Conflict,
  type DisclosureRecord,
  type DocVersion,
  type Redaction
} from './store';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const bundleQuery = async () => ({
  queue: [
    { id: 'Q-31', name: '第三批补充材料', count: 128, owner: '林清', progress: 68, due: '今日 16:00' },
    { id: 'Q-32', name: '证人材料图像件', count: 47, owner: '周叙', progress: 34, due: '明日 11:00' },
    { id: 'Q-33', name: '专家报告附件', count: 19, owner: '顾言', progress: 91, due: '09-30 18:00' }
  ]
});

function describeRegion(r: Redaction | null): string {
  if (!r) return '（该侧已删除此区域）';
  return `${r.reason} · 第${r.page}页 · 坐标 ${Math.round(r.x * 100)}%,${Math.round(r.y * 100)}%`;
}

function describeFieldValue(field: string, value: unknown): string {
  if (field === 'classification') return String(value);
  if (field === 'decision') return value === 'passed' ? '通过' : value === 'rejected' ? '退回' : '待复核';
  if (field === 'approvedVersion') return value ? formatVersion(value as DocVersion) : '未批准';
  if (field.startsWith('check:')) return value ? '已勾选' : '未勾选';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

function fieldLabel(field: string): string {
  if (field === 'classification') return '密级';
  if (field === 'metadataCleaned') return '元数据清理';
  if (field === 'decision') return '复核结论';
  if (field === 'approvedVersion') return '批准版本';
  if (field.startsWith('check:')) return `质检项 · ${reviewCheckDefs.find((c) => c.id === field.slice(6))?.label ?? field.slice(6)}`;
  return field;
}

function ConflictCard({ conflict }: { conflict: Conflict }) {
  const adjudicateRegion = useDisclosureStore((s) => s.adjudicateRegionConflict);
  const adjudicateField = useDisclosureStore((s) => s.adjudicateFieldConflict);
  if (conflict.kind === 'region') {
    return (
      <div className="conflict-item">
        <div className="conflict-head"><Scale size={14} /><span>区域冲突 · {conflict.docId} · {conflict.regionId}</span></div>
        <div className="conflict-sides">
          <div className="conflict-side">
            <strong>本侧（稍后保存）</strong>
            <span>{describeRegion(conflict.local)}</span>
            <Button variant="outline" onClick={() => adjudicateRegion(conflict.docId, conflict.regionId, 'local')}>采用本侧</Button>
          </div>
          <div className="conflict-side">
            <strong>另一侧（先保存）</strong>
            <span>{describeRegion(conflict.remote)}</span>
            <Button variant="outline" onClick={() => adjudicateRegion(conflict.docId, conflict.regionId, 'remote')}>采用另一侧</Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="conflict-item">
      <div className="conflict-head"><Scale size={14} /><span>字段冲突 · {conflict.docId} · {fieldLabel(conflict.field)}</span></div>
      <div className="conflict-sides">
        <div className="conflict-side">
          <strong>本侧</strong>
          <span>{describeFieldValue(conflict.field, conflict.local)}</span>
          <Button variant="outline" onClick={() => adjudicateField(conflict.docId, conflict.field, 'local')}>采用本侧</Button>
        </div>
        <div className="conflict-side">
          <strong>另一侧</strong>
          <span>{describeFieldValue(conflict.field, conflict.remote)}</span>
          <Button variant="outline" onClick={() => adjudicateField(conflict.docId, conflict.field, 'remote')}>采用另一侧</Button>
        </div>
      </div>
    </div>
  );
}

function MergeBanner() {
  const mergeStatus = useDisclosureStore((s) => s.mergeStatus);
  const conflicts = useDisclosureStore((s) => s.conflicts);
  const mergeError = useDisclosureStore((s) => s.mergeError);
  const retryMerge = useDisclosureStore((s) => s.retryMerge);
  const restoreSnapshot = useDisclosureStore((s) => s.restoreSnapshot);
  if (mergeStatus === 'idle') return null;
  return (
    <div className={`merge-banner ${mergeStatus}`}>
      {mergeStatus === 'conflict' && (
        <>
          <div className="merge-banner-head"><GitMerge size={16} /><strong>检测到另一标签页与本侧同时修改</strong><span>同一区域两边都改过，已保留两份副本，等待裁决，期间批次不可标记可发布。</span></div>
          <div className="conflict-list">{conflicts.map((c) => <ConflictCard key={`${c.kind}-${c.docId}-${c.kind === 'region' ? c.regionId : c.field}`} conflict={c} />)}</div>
        </>
      )}
      {mergeStatus === 'failed' && (
        <>
          <div className="merge-banner-head"><AlertTriangle size={16} /><strong>合并或重算失败</strong><span>{mergeError ?? '结构校验未通过'}。已保留上一份可恢复快照，可重试或恢复。</span></div>
          <div className="merge-banner-actions">
            <Button variant="outline" onClick={retryMerge}><RotateCw size={15} /> 重试合并</Button>
            <Button variant="outline" onClick={restoreSnapshot}><History size={15} /> 恢复上一份快照</Button>
          </div>
        </>
      )}
    </div>
  );
}

function AppShell() {
  const [mobileNav, setMobileNav] = useState(false);
  const links = [
    { to: '/', label: '文档集', icon: Layers3 },
    { to: '/review/$documentId', label: '去密审阅', icon: Highlighter },
    { to: '/quality', label: '发布质检', icon: ScanSearch },
    { to: '/batches', label: '批次与标签', icon: Tags }
  ];
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        const remote = parsed?.state;
        if (!remote || !Array.isArray(remote.documents)) return;
        useDisclosureStore.getState().applyRemoteState({ documents: remote.documents, batches: remote.batches ?? [] });
      } catch {
        /* ignore malformed remote */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-symbol"><Stamp size={18} /></div>
          <div><strong>披露质控台</strong><span>North Ridge / Litigation Support</span></div>
        </div>
        <div className="top-actions">
          <Badge tone="amber">2 项待质检</Badge>
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
            {links.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to as '/'} activeProps={{ className: 'active' }} onClick={() => setMobileNav(false)}>
                <Icon size={17} /> <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div><ShieldCheck size={16} /><span>审计记录已开启</span></div>
            <small>草稿自动保存在本机 · 多标签页合并</small>
          </div>
        </aside>
        <main className="main-content"><MergeBanner /><Outlet /></main>
      </div>
    </div>
  );
}

function DocumentsPage() {
  const documents = useDisclosureStore((state) => state.documents);
  const { data } = useQuery({ queryKey: ['document-queues'], queryFn: bundleQuery });
  const [filter, setFilter] = useState('全部');
  const visible = filter === '全部' ? documents : documents.filter((doc) => doc.status === filter);
  return (
    <div className="page">
      <header className="page-heading">
        <div><small>DISCLOSURE CONTROL / DOCUMENT SET</small><h1>披露文档集</h1><p>分批完成密级复核、敏感区域去密与发布版本比对；内容改动后发布资格立即重算。</p></div>
        <Button><UploadCloud size={16} /> 导入文档集</Button>
      </header>
      <section className="summary-strip">
        <div><span>文档总数</span><strong>194</strong><small>12.8 GB</small></div>
        <div><span>去密区域</span><strong>2,481</strong><small>较上版 +34</small></div>
        <div><span>待质检</span><strong className="warning-text">17</strong><small>4 项高风险</small></div>
        <div><span>已批准批次</span><strong>6</strong><small>本周 +2</small></div>
      </section>
      <div className="two-column">
        <Card className="document-table-card">
          <div className="card-heading">
            <div><Tabs.Root value={filter} onValueChange={setFilter}><Tabs.List className="segmented">
              {['全部', '去密中', '待质检', '可发布'].map((item) => <Tabs.Trigger key={item} value={item}>{item}</Tabs.Trigger>)}
            </Tabs.List></Tabs.Root></div>
            <span>{visible.length} 份文档</span>
          </div>
          <div className="document-table">
            {visible.map((doc) => (
              <div className="document-row" key={doc.id}>
                <div className="file-icon"><FileText size={19} /></div>
                <div className="doc-main">
                  <strong>{doc.title}</strong>
                  <span>{doc.id} · {doc.bundle} · {doc.size}</span>
                </div>
                <div className="doc-field"><span>版本</span><strong className="version-text">{formatVersion(doc.version)}</strong></div>
                <div className="doc-field"><span>密级</span><Badge tone={doc.classification === '严格机密' ? 'red' : doc.classification === '机密' ? 'amber' : 'neutral'}>{doc.classification}</Badge></div>
                <div className="doc-field"><span>状态</span><Badge tone={doc.status === '可发布' ? 'green' : doc.status === '待质检' ? 'amber' : 'blue'}>{doc.status}</Badge></div>
                <div className="doc-actions">
                  <Link to="/review/$documentId" params={{ documentId: doc.id }}><Button variant="outline">审阅</Button></Link>
                </div>
              </div>
            ))}
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
            <div className="card-title"><ShieldCheck size={17} /><strong>最近操作</strong></div>
            <p><b>09:48</b> 林清确认 DOC-00418 的合同价款遮蔽区域。</p>
            <p><b>09:31</b> 周叙提交会议纪要待质检。</p>
            <p><b>08:54</b> 顾言导出 DOC-00435 发布清单。</p>
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
  const { documents, activePage, redactionMode, activeRedactionId } = useDisclosureStore();
  const store = useDisclosureStore();
  const doc = documents.find((item) => item.id === documentId) ?? documents[0];
  const pageRegions = doc.redactions.filter((item) => item.page === activePage);
  const active = doc.redactions.find((item) => item.id === activeRedactionId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState('商业秘密');
  const [privilege, setPrivilege] = useState('合同保密');
  const stale = doc.review.decision === 'passed' && doc.review.approvedVersion && (doc.review.approvedVersion.major !== doc.version.major || doc.review.approvedVersion.minor !== doc.version.minor);
  return (
    <div className="page review-page">
      <header className="review-header">
        <div className="review-title">
          <Button variant="ghost" onClick={() => navigate({ to: '/' })}><ArrowLeft size={16} /></Button>
          <div><small>{doc.id} / 去密审阅</small><h1>{doc.title}</h1></div>
          <Badge tone={doc.classification === '严格机密' ? 'red' : 'amber'}>{doc.classification}</Badge>
          <Badge tone="blue" className="version-badge">{formatVersion(doc.version)}</Badge>
          {stale && <Badge tone="red">发布后已改动 · 需重新质检</Badge>}
        </div>
        <div className="review-actions">
          <Button variant="outline" onClick={() => store.toggleRedactionMode()} className={redactionMode ? 'active-button' : ''}><Highlighter size={16} /> {redactionMode ? '取消绘制' : '绘制去密区'}</Button>
          <Button variant="outline" onClick={() => setDialogOpen(true)}><FileCheck2 size={16} /> 发布前校验</Button>
          <Button><Check size={16} /> 提交质检</Button>
        </div>
      </header>
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
              onDraw={redactionMode ? (region) => store.addRedaction({ ...region, page: activePage, reason, privilege }) : undefined}
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
              <label>保密级别<select value={doc.classification} onChange={(event) => store.updateClassification(event.target.value as DisclosureRecord['classification'])}><option>内部</option><option>机密</option><option>严格机密</option></select></label>
              <label>去密原因<input value={active.reason} readOnly /></label>
              <label>特权标签<input value={active.privilege} readOnly /></label>
              <label>责任人员<input value={doc.owner} readOnly /></label>
              <div className="coordinate-grid"><div><span>X</span><b>{Math.round(active.x * 100)}%</b></div><div><span>Y</span><b>{Math.round(active.y * 100)}%</b></div><div><span>宽</span><b>{Math.round(active.width * 100)}%</b></div><div><span>高</span><b>{Math.round(active.height * 100)}%</b></div></div>
              <Button onClick={() => store.confirmRedaction(active.id)} disabled={active.status === 'confirmed'}><Check size={15} /> 确认此区域</Button>
              <Button variant="outline"><Copy size={15} /> 批量复制到同类页</Button>
            </>
          ) : <p className="muted">在文档页面上选择一个去密区域查看属性。</p>}
          <div className="rule-note"><AlertTriangle size={16} /><span>发布版本不得包含原始文本层或图片残片。</span></div>
        </aside>
      </div>
      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>发布前校验</Dialog.Title>
            <Dialog.Description>系统将核对原始页与发布页的一致性，并检查元数据残留。</Dialog.Description>
            <div className="dialog-checks">
              <p><Check /> {doc.redactions.length} 个去密区域已定位</p>
              <p><Check /> 文档版本 {formatVersion(doc.version)} · 操作者记录完整</p>
              <p className={doc.redactions.some((item) => item.status === 'draft') ? 'failed' : ''}><AlertTriangle /> {doc.redactions.some((item) => item.status === 'draft') ? '仍有未确认区域' : '所有区域已确认'}</p>
            </div>
            <Dialog.Close asChild><Button>返回检查 <X size={15} /></Button></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function QualityPage() {
  const { documents, activeDocumentId } = useDisclosureStore();
  const store = useDisclosureStore();
  const doc = documents.find((d) => d.id === activeDocumentId) ?? documents[0];
  const mergeStatus = useDisclosureStore((s) => s.mergeStatus);
  const conflicts = useDisclosureStore((s) => s.conflicts);
  const allChecks = reviewCheckDefs.every((check) => doc.review.checks[check.id]);
  const allConfirmed = doc.redactions.length > 0 && doc.redactions.every((r) => r.status === 'confirmed');
  const mergeBlocked = mergeStatus !== 'idle' || conflicts.length > 0;
  const canApprove = !mergeBlocked && allChecks && doc.review.metadataCleaned && allConfirmed;
  const docBlockers: string[] = [];
  if (mergeStatus === 'failed') docBlockers.push('合并或重算失败，请先恢复快照或重试');
  if (conflicts.length > 0) docBlockers.push(`存在 ${conflicts.length} 处冲突待裁决`);
  if (!allConfirmed) docBlockers.push('仍有未确认去密区域');
  if (!allChecks) docBlockers.push('质检项未全部勾选');
  if (!doc.review.metadataCleaned) docBlockers.push('元数据未清理');
  return (
    <div className="page">
      <header className="page-heading"><div><small>QUALITY ASSURANCE / SIDE-BY-SIDE</small><h1>发布质检双人复核</h1><p>并排检查原始页与发布页，所有差异必须留下复核结论；结论改动后发布资格立即重算。</p></div><Button><FileCheck2 size={16} /> 导出发布清单</Button></header>
      <div className="comparison-banner">
        <div><Eye size={17} /><strong>{doc.title}</strong><span>{doc.id} · {formatVersion(doc.version)} · 双人复核</span></div>
        <div className="banner-doc-select">
          <select value={doc.id} onChange={(e) => store.selectDocument(e.target.value)}>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.id} · {d.title}</option>)}
          </select>
          <Badge tone={doc.review.decision === 'passed' ? 'green' : doc.review.decision === 'rejected' ? 'red' : 'amber'}>
            {doc.review.decision === 'passed' ? '已通过' : doc.review.decision === 'rejected' ? '已退回' : '等待复核'}
          </Badge>
        </div>
      </div>
      <div className="compare-grid">
        <Card className="compare-panel"><div className="compare-head"><span>原始页</span><Badge tone="neutral">源文件</Badge></div><div className="compare-page"><PdfPage pageNumber={1} /></div></Card>
        <Card className="compare-panel"><div className="compare-head"><span>发布页</span><Badge tone="green">已遮蔽</Badge></div><div className="compare-page redacted-preview"><PdfPage pageNumber={1} redacted /><div className="demo-mask mask-one" /><div className="demo-mask mask-two" /></div></Card>
      </div>
      <div className="quality-bottom">
        <Card className="checks-card"><div className="card-title"><ClipboardCheck size={17} /><strong>发布前校验项</strong></div>{reviewCheckDefs.map((check) => <button className="check-row" key={check.id} onClick={() => store.toggleReviewCheck(doc.id, check.id)}><span className={doc.review.checks[check.id] ? 'checked' : ''}>{doc.review.checks[check.id] && <Check size={13} />}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></button>)}</Card>
        <Card className="decision-card">
          <div className="card-title"><ShieldCheck size={17} /><strong>复核结论</strong></div>
          <p>本批次共有 <b>{doc.redactions.length}</b> 个去密区域，其中已确认 {doc.redactions.filter((item) => item.status === 'confirmed').length} 个。</p>
          <label><input type="checkbox" checked={doc.review.metadataCleaned} onChange={() => store.toggleMetadata(doc.id)} /> 已确认元数据清理</label>
          {docBlockers.length > 0 && (
            <div className="blocker-list">
              {docBlockers.map((b) => <p key={b}><AlertTriangle size={13} /> {b}</p>)}
            </div>
          )}
          <div className="decision-actions">
            <Button variant="outline" onClick={() => store.rejectDocument(doc.id)}><ArrowLeft size={15} /> 退回补件</Button>
            <Button disabled={!canApprove} onClick={() => store.approveDocument(doc.id)}><Check size={15} /> 通过并标记可发布</Button>
          </div>
          {mergeBlocked && <p className="merge-gate-note">完整合并前不可标记可发布。</p>}
        </Card>
      </div>
    </div>
  );
}

function BatchesPage() {
  const { documents, batches } = useDisclosureStore();
  const mergeStatus = useDisclosureStore((s) => s.mergeStatus);
  const conflicts = useDisclosureStore((s) => s.conflicts);
  const [selectedBatchId, setSelectedBatchId] = useState(batches[0]?.id ?? 'BATCH-01');
  const selectedBatch = batches.find((b) => b.id === selectedBatchId) ?? batches[0];
  const batchDocs = selectedBatch.documentIds.map((id) => documents.find((d) => d.id === id)).filter((d): d is DisclosureRecord => Boolean(d));
  const blockers = batchBlockers(selectedBatch, documents, mergeStatus, conflicts);
  const canRelease = selectedBatch.releaseEligible && mergeStatus === 'idle' && conflicts.length === 0;
  return (
    <div className="page">
      <header className="page-heading"><div><small>RELEASE BATCH / TAXONOMY</small><h1>发布批次与标签</h1><p>按案件问题、辖区和披露对象组织文档；内容改动后批次发布资格立即失效并重算。</p></div><Button disabled={!canRelease}>{canRelease ? '生成发布包' : '批次未可发布'}</Button></header>
      <div className="batch-layout">
        <Card className="batch-list">
          <div className="card-title"><Layers3 size={17} /><strong>发布批次</strong></div>
          {batches.map((batch) => (
            <button key={batch.id} className={batch.id === selectedBatchId ? 'active' : ''} onClick={() => setSelectedBatchId(batch.id)}>
              <span>{batch.id}</span>
              <strong>{batch.name}</strong>
              <small>{batch.documentIds.length} 份文档 · {batch.status}</small>
            </button>
          ))}
        </Card>
        <Card className="batch-content">
          <div className="card-title"><Tags size={17} /><strong>文档与案件问题映射</strong><span>{batchDocs.length} 份</span></div>
          <div className="batch-table">
            {batchDocs.map((doc) => (
              <div className="batch-row" key={doc.id}>
                <FileText size={17} />
                <div><strong>{doc.title}</strong><span>{doc.id} · {doc.issue} · {formatVersion(doc.version)}</span></div>
                <Badge tone={doc.status === '可发布' ? 'green' : doc.status === '待质检' ? 'amber' : 'blue'}>{doc.status}</Badge>
              </div>
            ))}
            {batchDocs.length === 0 && <p className="muted empty-batch">本批次暂无文档。</p>}
          </div>
          <div className="tag-editor">
            <h3>标签与分发级</h3>
            <div className="tag-options">{(['合同问题', '设备缺陷', '现场安全', '损害赔偿', '仅律师可见']).map((tag, index) => <span key={tag} className={index < 3 ? 'selected' : ''}>{tag}</span>)}</div>
            <label>导出清单说明<textarea defaultValue="按案卷编号升序导出，保留去密版本、操作者与审批时间。" /></label>
            <Button>保存批次设置</Button>
          </div>
        </Card>
        <Card className="batch-summary">
          <div className="side-label">当前批次摘要</div>
          <strong>{selectedBatch.name}</strong>
          <dl>
            <div><dt>文档</dt><dd>{batchDocs.length}</dd></div>
            <div><dt>页数</dt><dd>{batchDocs.reduce((sum, doc) => sum + doc.pages, 0)}</dd></div>
            <div><dt>版本</dt><dd>{batchDocs.map((d) => `${d.id} ${formatVersion(d.version)}`).join('；') || '—'}</dd></div>
          </dl>
          <div className={`release-gate ${canRelease ? 'ok' : 'blocked'}`}>
            <div className="release-gate-head">
              <ShieldCheck size={15} />
              <strong>{canRelease ? '发布资格已重算通过' : '发布资格未就绪'}</strong>
            </div>
            {blockers.length > 0 ? (
              <ul className="blocker-list">
                {blockers.map((b) => <li key={b}><AlertTriangle size={12} /> {b}</li>)}
              </ul>
            ) : (
              <p className="gate-ok-note">全部文档已确认区域、完成质检并清理元数据，版本一致。</p>
            )}
          </div>
        </Card>
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
