import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx-js-style';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import {
  Download,
  FileSpreadsheet,
  RefreshCw,
  Check,
  AlertCircle,
  X,
  Calendar,
  Calculator,
  CheckCircle2,
  AlertTriangle,
  CloudOff
} from 'lucide-react';
import {
  SheetData,
  MonthDoc,
  ComputedChips,
  cellToA1,
  colToLetter,
  isComputedCell,
  isNumericValue,
  runFormulaEngine,
  buildMergeMap,
  sortSheetNames,
  loadSheetFromFirestore,
  exportMonthWorkbook,
  CellValue,
  colorToCss,
  CANON_TABLE,
  CANON_INDEX,
  CANON_COL_WIDTHS_PX,
  buildDaySheetTemplate,
  buildReminderTemplate,
  templateToSheetData,
  ALL_SHEET_NAMES
} from './hisabXL';
import { obSetPath, OutboxBanner } from './lib/outbox';
import { mirrorGetSheet, mirrorSetSheet, mirrorGetMonthDoc, mirrorSetMonthDoc } from './lib/hisabMirror';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

interface EditingCellState {
  row: number; // 0-based
  col: number; // 0-based
  value: string;
  origValue: string; // value at edit start (no-change -> close without save)
}

// Current REAL month "YYYY-MM" + aaj ki date
const realMonthId = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
};
const realMonthLabel = () => {
  const n = new Date();
  return `${MONTH_NAMES[n.getMonth()]}-${n.getFullYear()}`;
};
const todayDayStr = () => String(new Date().getDate());

export default function HisabXLScreen() {
  // Month list and active selection
  const [months, setMonths] = useState<MonthDoc[]>([]);
  const [selectedMonthId, setSelectedMonthId] = useState<string>('');
  const [loadingMonths, setLoadingMonths] = useState<boolean>(true);

  // Active sheet & cached sheets
  const [activeSheetName, setActiveSheetName] = useState<string>('');
  const [sheetsCache, setSheetsCache] = useState<{ [sheetName: string]: SheetData }>({});
  const [loadingSheet, setLoadingSheet] = useState<boolean>(false);

  // Editing cell state
  const [editingCell, setEditingCell] = useState<EditingCellState | null>(null);
  const [savingCell, setSavingCell] = useState<boolean>(false);

  // Toast feedback
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const prevMonthRef = useRef<string>('');

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  const isDaySheetName = (name: string) => !isNaN(Number(name)) && name.trim() !== '';

  // ============================================================
  // TEMPLATE / MIRROR FALLBACK CHAIN (offline-first home)
  // Firestore doc na mile (offline / naya month) -> mirror -> fresh template
  // ============================================================
  const buildFallbackSheet = useCallback((monthId: string, name: string): SheetData => {
    const isDay = isDaySheetName(name);
    const mir = mirrorGetSheet(monthId, name);
    if (mir) {
      const grid = isDay ? runFormulaEngine(mir.grid).grid : mir.grid;
      return {
        name,
        grid,
        merges: mir.merges || [],
        cols: mir.cols || [],
        styleTable: isDay ? (CANON_TABLE as unknown as Record<string, unknown>[]) : undefined,
        styleIndex: isDay ? CANON_INDEX : undefined,
        fromMirror: true
      } as SheetData & { fromMirror?: boolean };
    }
    const tpl = isDay ? buildDaySheetTemplate(Number(name)) : buildReminderTemplate();
    const grid = isDay ? runFormulaEngine(tpl.grid).grid : tpl.grid;
    return templateToSheetData(name, { ...tpl, grid }, isDay);
  }, []);

  // Naya (ya mirror-me-bana) month ensure karo: list me daalo + month doc +
  // aaj ki day sheet Firestore par queue karo (deterministic opId — idempotent)
  const ensureCurrentMonth = useCallback((list: MonthDoc[]): MonthDoc[] => {
    const monthId = realMonthId();
    const exists = list.some((m) => m.monthId === monthId);
    if (exists) return list;

    const label = realMonthLabel();
    const mirrored = mirrorGetMonthDoc(monthId);
    const synthetic: MonthDoc = {
      monthId,
      label: mirrored?.label || label,
      sheetNames: mirrored?.sheetNames || ALL_SHEET_NAMES,
      synthetic: true
    } as MonthDoc;

    // Month doc queue (merge:true — existing fields kabhi corrupt nahi)
    obSetPath(
      ['hisab', monthId],
      { monthId, label, sheetNames: ALL_SHEET_NAMES, createdAtLocal: Date.now() },
      { merge: true, opId: `hisab-m-${monthId}` }
    );
    mirrorSetMonthDoc(monthId, { label, sheetNames: ALL_SHEET_NAMES });

    // Aaj ka din Firestore par bhi banta hai (fresh 0 — Boss rule: roz naya date)
    const today = todayDayStr();
    const todayTpl = buildDaySheetTemplate(Number(today));
    const todayProcessed = runFormulaEngine(todayTpl.grid).grid;
    const todayDoc = templateToSheetData(today, { ...todayTpl, grid: todayProcessed }, true);
    obSetPath(['hisab', monthId, 'sheets', today], { ...todayDoc, updatedAtLocal: Date.now() }, {
      merge: false,
      opId: `hisab-s-${monthId}-${today}`
    });
    mirrorSetSheet(monthId, today, { grid: todayProcessed, merges: todayDoc.merges, cols: todayDoc.cols });

    return [synthetic, ...list];
  }, []);

  // 1. Fetch available months from Firestore + ensure current month
  const fetchMonths = useCallback(
    async (selectLatest = false, targetId?: string) => {
      setLoadingMonths(true);
      try {
        const q = query(collection(db, 'hisab'), orderBy('monthId', 'desc'));
        const snap = await getDocs(q);
        const list: MonthDoc[] = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            monthId: d.id,
            label: data.label || d.id,
            sheetNames: Array.isArray(data.sheetNames) ? data.sheetNames : [],
            createdAt: data.createdAt,
            createdBy: data.createdBy,
            closed: data.closed
          });
        });

        list.sort((a, b) => b.monthId.localeCompare(a.monthId));
        const finalList = ensureCurrentMonth(list);
        setMonths(finalList);

        const withCurrent = finalList.some((m) => m.monthId === realMonthId());
        if (finalList.length > 0) {
          if (targetId && finalList.some((m) => m.monthId === targetId)) {
            setSelectedMonthId(targetId);
          } else if (selectLatest || !selectedMonthId || !finalList.some((m) => m.monthId === selectedMonthId)) {
            // HOME RULE: hamesha AAJ KA MAHINA default (naya month auto-bana)
            setSelectedMonthId(withCurrent ? realMonthId() : finalList[0].monthId);
          }
        } else {
          setSelectedMonthId('');
        }
      } catch (err: unknown) {
        console.error('Failed to fetch hisab months:', err);
        // OFFLINE fallback: mirror months + synthetic current month — kaam chalta rahega
        const fallback: MonthDoc[] = [];
        const cur = realMonthId();
        const mirrored = mirrorGetMonthDoc(cur);
        fallback.push({
          monthId: cur,
          label: mirrored?.label || realMonthLabel(),
          sheetNames: mirrored?.sheetNames || ALL_SHEET_NAMES,
          synthetic: true
        } as MonthDoc);
        const finalList = ensureCurrentMonth(fallback);
        setMonths(finalList);
        if (!selectedMonthId) setSelectedMonthId(cur);
        const msg = (err as Error)?.message || '';
        if (msg.includes('permission') || msg.includes('Permission')) {
          showToast('Permission denied — Firebase Console me hisab rules publish karo', 'error');
        }
      } finally {
        setLoadingMonths(false);
      }
    },
    [ensureCurrentMonth, selectedMonthId]
  );

  useEffect(() => {
    fetchMonths(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Current active month object
  const currentMonth = useMemo(() => {
    return months.find((m) => m.monthId === selectedMonthId) || null;
  }, [months, selectedMonthId]);

  // Sorted sheet names for the current month (1..31 + Reminder)
  const sortedSheetNames = useMemo(() => {
    if (!currentMonth || !currentMonth.sheetNames) return [];
    return sortSheetNames(currentMonth.sheetNames);
  }, [currentMonth]);

  // Active sheet: month change par default = AAJ KI DATE (home rule) —
  // doosre month me pehli sheet. Baaki wahi sheet rahegi jo Boss ne kholi hai.
  useEffect(() => {
    if (sortedSheetNames.length === 0) {
      setActiveSheetName('');
      return;
    }
    const monthChanged = prevMonthRef.current !== selectedMonthId;
    prevMonthRef.current = selectedMonthId;
    if (monthChanged || !activeSheetName || !sortedSheetNames.includes(activeSheetName)) {
      setActiveSheetName(
        selectedMonthId === realMonthId() && sortedSheetNames.includes(todayDayStr())
          ? todayDayStr()
          : sortedSheetNames[0]
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonthId, sortedSheetNames]);

  // 2. Fetch active sheet: Firestore -> MIRROR -> fresh template (offline-first)
  useEffect(() => {
    if (!selectedMonthId || !activeSheetName) return;

    // Cache key is MONTH-SCOPED: same sheet name in different months must never collide
    const cacheKey = `${selectedMonthId}::${activeSheetName}`;
    if (sheetsCache[cacheKey]) return;

    let isMounted = true;
    setLoadingSheet(true);

    const cacheIt = (sheetData: SheetData) => {
      const isNumericSheet = isDaySheetName(activeSheetName);
      const processed = isNumericSheet ? runFormulaEngine(sheetData.grid).grid : sheetData.grid;
      setSheetsCache((prev) => ({
        ...prev,
        [cacheKey]: {
          ...sheetData,
          grid: processed
        }
      }));
    };

    loadSheetFromFirestore(db, selectedMonthId, activeSheetName)
      .then((sheetData) => {
        if (!isMounted) return;
        if (sheetData) {
          cacheIt(sheetData);
        } else {
          // Doc nahi mila (naya month / kabhi sync nahi hua) -> mirror/template
          cacheIt(buildFallbackSheet(selectedMonthId, activeSheetName));
        }
      })
      .catch((err) => {
        console.error('Error loading sheet (offline fallback):', err);
        if (!isMounted) return;
        // OFFLINE: persistent cache empty tha -> mirror/template se turant kaam
        cacheIt(buildFallbackSheet(selectedMonthId, activeSheetName));
        const msg = (err as Error)?.message || '';
        if (msg.includes('permission')) {
          showToast('Permission denied — Firebase Console me hisab rules publish karo', 'error');
        }
      })
      .finally(() => {
        if (isMounted) setLoadingSheet(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedMonthId, activeSheetName, sheetsCache, buildFallbackSheet]);

  // Active sheet data (month-scoped cache key)
  const currentSheet = useMemo(() => {
    return sheetsCache[`${selectedMonthId}::${activeSheetName}`] || null;
  }, [sheetsCache, selectedMonthId, activeSheetName]);

  // Compute live formula chips for current sheet
  const { liveGrid, liveChips } = useMemo<{ liveGrid: CellValue[][]; liveChips: ComputedChips }>(() => {
    if (!currentSheet || !currentSheet.grid || currentSheet.grid.length === 0) {
      return {
        liveGrid: [],
        liveChips: { cash1no: 0, recipt1no: 0, csah2no: 0, recipt2no: 0 }
      };
    }
    const isNumericSheet = isDaySheetName(activeSheetName);
    if (isNumericSheet) {
      const res = runFormulaEngine(currentSheet.grid);
      return { liveGrid: res.grid, liveChips: res.chips };
    } else {
      return {
        liveGrid: currentSheet.grid,
        liveChips: { cash1no: 0, recipt1no: 0, csah2no: 0, recipt2no: 0 }
      };
    }
  }, [currentSheet, activeSheetName]);

  // Merge map for current sheet
  const mergeMap = useMemo(() => {
    if (!currentSheet || !currentSheet.merges) return new Map();
    return buildMergeMap(currentSheet.merges);
  }, [currentSheet]);

  // 4. Cell Click / Edit Handling
  const handleCellClick = (r: number, c: number) => {
    // If computed cell, don't allow edit
    if (isComputedCell(r, c)) {
      showToast('Computed formula cell (auto-calculated) — cannot edit directly.', 'info');
      return;
    }

    const currentVal = liveGrid[r]?.[c] ?? '';
    setEditingCell({
      row: r,
      col: c,
      value: String(currentVal ?? ''),
      origValue: String(currentVal ?? '')
    });
  };

  const handleSaveCell = async (valueOverride?: string) => {
    if (!editingCell || !currentSheet || !selectedMonthId || savingCell) return;

    const { row, col } = editingCell;
    const value = valueOverride !== undefined ? valueOverride : editingCell.value;

    // No change -> close editor without saving (Excel behaviour)
    if (valueOverride === undefined && value === editingCell.origValue) {
      setEditingCell((prev) => (prev && prev.row === row && prev.col === col ? null : prev));
      return;
    }

    setSavingCell(true);

    // Clone grid
    const updatedGrid = currentSheet.grid.map((r) => [...r]);
    // Determine whether value is numeric or string
    let parsedVal: CellValue = value.trim();
    if (parsedVal === '') {
      parsedVal = null;
    } else if (!isNaN(Number(parsedVal))) {
      parsedVal = Number(parsedVal);
    }
    updatedGrid[row][col] = parsedVal;

    // Run formula engine if numeric sheet
    const isNumericSheet = isDaySheetName(activeSheetName);
    const processedGrid = isNumericSheet ? runFormulaEngine(updatedGrid).grid : updatedGrid;

    const updatedSheet: SheetData = {
      ...currentSheet,
      grid: processedGrid
    };

    // ============================================================
    // OUTBOX SAVE (offline-first): mirror (L4) + journal (L2) -> Firestore
    // Deterministic opId = same sheet ke repeat edits journal me REPLACE hote
    // hain (latest state wins) — net aane par sirf final state sync hota hai.
    // ============================================================
    try {
      mirrorSetSheet(selectedMonthId, activeSheetName, {
        grid: processedGrid,
        merges: updatedSheet.merges,
        cols: updatedSheet.cols
      });

      const docPayload: Record<string, unknown> = {
        name: activeSheetName,
        grid: processedGrid,
        merges: updatedSheet.merges,
        cols: updatedSheet.cols,
        updatedAtLocal: Date.now()
      };
      if (isNumericSheet) {
        docPayload.styleTable = CANON_TABLE as unknown as Record<string, unknown>[];
        docPayload.styleIndex = CANON_INDEX;
      } else {
        if (updatedSheet.styleTable) docPayload.styleTable = updatedSheet.styleTable;
        if (updatedSheet.styleIndex) docPayload.styleIndex = updatedSheet.styleIndex;
      }

      await obSetPath(['hisab', selectedMonthId, 'sheets', activeSheetName], docPayload, {
        merge: false,
        opId: `hisab-s-${selectedMonthId}-${activeSheetName}`
      });

      // Update local state (month-scoped cache key)
      setSheetsCache((prev) => ({
        ...prev,
        [`${selectedMonthId}::${activeSheetName}`]: updatedSheet
      }));
      setEditingCell((prev) => (prev && prev.row === row && prev.col === col ? null : prev));
    } catch (err: unknown) {
      console.error('Cell save error:', err);
      const msg = (err as Error)?.message || '';
      if (msg.includes('permission') || msg.includes('Permission')) {
        showToast('Permission denied — Firebase Console me hisab rules publish karo', 'error');
      } else {
        showToast(`Save failed: ${msg}`, 'error');
      }
    } finally {
      setSavingCell(false);
    }
  };

  // 5. Handle Full Workbook Download (month-end XL backup — real Excel formulas)
  const handleDownloadWorkbook = async () => {
    if (!currentMonth || !selectedMonthId) {
      showToast('Koi mahina select nahi hai', 'error');
      return;
    }

    showToast('Preparing Excel workbook download...', 'info');

    try {
      // Only reuse cache entries belonging to THIS month (keys are "<monthId>::<sheet>")
      const allSheets: { [sheetName: string]: SheetData } = {};
      const monthPrefix = `${selectedMonthId}::`;
      for (const [k, v] of Object.entries(sheetsCache)) {
        if (k.startsWith(monthPrefix)) {
          allSheets[k.slice(monthPrefix.length)] = v;
        }
      }

      // Ensure all sheets: Firestore -> mirror -> fresh template (offline bhi poora XL)
      for (const name of currentMonth.sheetNames) {
        if (!allSheets[name]) {
          let loaded: SheetData | null = null;
          try {
            loaded = await loadSheetFromFirestore(db, selectedMonthId, name);
          } catch {
            loaded = null; // offline
          }
          if (!loaded) loaded = buildFallbackSheet(selectedMonthId, name);
          allSheets[name] = loaded;
        }
      }

      exportMonthWorkbook(currentMonth.label, currentMonth.sheetNames, allSheets);
      showToast(`✓ SHIVAM-HISAB-${currentMonth.label}.xlsx downloaded!`, 'success');
    } catch (err: unknown) {
      console.error('Download error:', err);
      showToast(`Download failed: ${(err as Error)?.message || ''}`, 'error');
    }
  };

  // Visible columns are 0 to 28 (A to AC). AD..AK (29..36) are hidden helper columns in table.
  const visibleColCount = 29;
  const isDaySheet = isDaySheetName(activeSheetName);
  const isTodaySheet = selectedMonthId === realMonthId() && activeSheetName === todayDayStr();
  const dayNumForHeader = isDaySheet ? Number(activeSheetName) : null;
  const monthShort = MONTH_NAMES[Number(String(selectedMonthId).split('-')[1] || 1) - 1]?.slice(0, 3) || '';
  const todayLabel = `${String(new Date().getDate()).padStart(2, '0')} ${monthShort && selectedMonthId === realMonthId() ? monthShort.toUpperCase() : ''}`.trim();

  return (
    <div className="hisab-fullbleed flex min-h-screen flex-col bg-transparent text-slate-100">
      {/* Toast Notification (dark — navy theme) */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border px-5 py-3.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-md text-xs font-bold transition-all ${
            toast.type === 'success'
              ? 'border-emerald-500/40 bg-slate-900 text-emerald-300'
              : toast.type === 'error'
              ? 'border-rose-500/40 bg-slate-900 text-rose-300'
              : 'border-indigo-500/40 bg-slate-900 text-indigo-300'
          }`}
        >
          {toast.type === 'success' ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : toast.type === 'error' ? (
            <AlertCircle className="h-4 w-4 text-rose-400" />
          ) : (
            <Calculator className="h-4 w-4 text-indigo-400" />
          )}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-500 hover:text-slate-300">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Top Bar (premium navy ribbon): Month Selector + TODAY + Download */}
      <div className="sticky top-0 z-40 border-b border-slate-700/60 bg-gradient-to-r from-slate-950 via-[#0d1b3a] to-slate-950 shadow-xl shadow-black/30 backdrop-blur">
        <div className="h-[2px] w-full bg-gradient-to-r from-emerald-400/70 via-indigo-400/70 to-emerald-400/70" />
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-700 shadow-lg shadow-emerald-500/30 ring-1 ring-emerald-300/40">
              <FileSpreadsheet className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <h2 className="shivam-silver shivam-silver-shine-slow text-base font-black tracking-wide">HISAB XL</h2>
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-300/90">Daily Excel Accounts — Chart /10</p>
            </div>
          </div>

          {/* Month Selector Dropdown */}
          <div className="relative">
            <select
              value={selectedMonthId}
              onChange={(e) => {
                setSelectedMonthId(e.target.value);
                setSheetsCache({});
              }}
              disabled={loadingMonths || months.length === 0}
              className="rounded-lg border border-slate-600/70 bg-slate-950/90 px-3 py-1.5 text-xs font-bold text-slate-100 ring-1 ring-white/5 transition hover:border-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none disabled:opacity-50"
            >
              {months.length === 0 ? (
                <option value="">(No months yet)</option>
              ) : (
                months.map((m) => (
                  <option key={m.monthId} value={m.monthId}>
                    {m.label} ({m.sheetNames?.length || 0} sheets){m.synthetic ? ' • auto' : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* TODAY chip */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/40 bg-gradient-to-r from-indigo-500/20 via-violet-500/15 to-indigo-500/20 px-2.5 py-1 text-[10px] font-black tracking-wider text-indigo-200 ring-1 ring-inset ring-indigo-300/20">
            <Calendar className="h-3 w-3" />
            TODAY • {todayLabel}
          </span>

          <button
            onClick={() => fetchMonths(false, selectedMonthId)}
            title="Refresh Months"
            disabled={loadingMonths}
            className="rounded-lg border border-slate-600/70 bg-gradient-to-b from-slate-800 to-slate-900 p-1.5 text-slate-300 ring-1 ring-white/5 transition hover:from-slate-700 hover:text-white hover:shadow-lg hover:shadow-black/30 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingMonths ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>

        {/* Action Buttons — sirf DOWNLOAD (Boss order: upload option nahi) */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadWorkbook}
            disabled={!currentMonth || !selectedMonthId}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-1.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 ring-1 ring-emerald-300/40 transition-all hover:-translate-y-px hover:from-emerald-400 hover:to-teal-500 hover:shadow-xl hover:shadow-emerald-500/40 disabled:translate-y-0 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            <span>XL Download</span>
          </button>
        </div>
        </div>
      </div>

      {/* Offline-first banner (OFFLINE / SYNC PENDING) */}
      <div className="px-4 pt-3">
        <OutboxBanner />
      </div>

      {/* Live Formula Total Strip (navy cards) */}
      <div className="grid grid-cols-2 gap-2 px-4 pt-3 lg:grid-cols-4">
        {([
          { label: 'CASH 1NO', key: 'cash1no' as const, dot: 'bg-emerald-400', val: 'text-emerald-300', formula: 'AH53 = SUM(AH2:AH50)' },
          { label: 'RECEIPT 1NO', key: 'recipt1no' as const, dot: 'bg-sky-400', val: 'text-sky-300', formula: 'AI53 = SUM(AI2:AI50)' },
          { label: 'CASH 2NO', key: 'csah2no' as const, dot: 'bg-amber-400', val: 'text-amber-300', formula: 'AJ53 = SUM(AJ2:AJ50)' },
          { label: 'RECEIPT 2NO', key: 'recipt2no' as const, dot: 'bg-purple-400', val: 'text-purple-300', formula: 'AK53 = SUM(AK2:AK50)' }
        ]).map((chip) => (
          <div key={chip.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-700/60 bg-gradient-to-br from-slate-900 via-slate-900/70 to-slate-950 px-3.5 py-2.5 shadow-lg shadow-black/25 ring-1 ring-white/5 transition-all hover:-translate-y-px hover:border-slate-500/70 hover:shadow-xl">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${chip.dot} shadow-[0_0_6px_rgba(255,255,255,0.25)]`} />
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{chip.label}</span>
              </div>
              <p className="mt-0.5 truncate text-[9px] font-medium text-slate-600">{chip.formula}</p>
            </div>
            <span className={`font-mono text-base font-black ${chip.val}`}>
              ₹{liveChips[chip.key].toLocaleString('en-IN')}
            </span>
          </div>
        ))}
      </div>

      {/* Guide strip (Boss ke 3 rules — UI English) */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pt-2.5 text-[10.5px] font-semibold text-slate-400">
        <span>1 unit = ₹10 (200 = ₹2,000)</span>
        <span className="text-slate-700">|</span>
        <span>New day = fresh sheet, all counters start at 0</span>
        <span className="text-slate-700">|</span>
        <span>Click any cell to type — saves instantly, offline-safe</span>
        <span className="text-slate-700">|</span>
        <span className="inline-flex items-center gap-1 text-slate-500">
          <CloudOff className="h-3 w-3" /> works without internet
        </span>
      </div>

      {/* Day Tabs Bar (Excel sheet tabs — navy workbook look) */}
      {sortedSheetNames.length > 0 ? (
        <div className="px-4 pt-3">
          <div className="flex items-stretch gap-0 overflow-x-auto rounded-t-xl border border-b-0 border-slate-700/60 bg-gradient-to-b from-slate-900 to-slate-950/70 px-1 pt-1 shadow-lg shadow-black/25">
            {sortedSheetNames.map((name) => {
              const isSelected = activeSheetName === name;
              const isTodayTab = selectedMonthId === realMonthId() && name === todayDayStr();
              return (
                <button
                  key={name}
                  onClick={() => setActiveSheetName(name)}
                  title={isTodayTab ? 'Aaj ka din — fresh 0 se start' : isDaySheetName(name) ? `Day ${name}` : 'Haste & Reminder'}
                  className={`shrink-0 whitespace-nowrap rounded-t-lg border-r border-slate-700/60 px-3.5 py-1.5 text-xs font-semibold transition ${
                    isSelected
                      ? 'bg-gradient-to-b from-slate-950 to-[#0b1430] font-bold text-emerald-300 shadow-[inset_0_2px_0_0_rgb(52_211_153)]'
                      : isTodayTab
                      ? 'text-indigo-300 hover:bg-slate-800/60'
                      : 'text-slate-400 hover:bg-slate-800/60'
                  }`}
                >
                  {name}
                  {isTodayTab && <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400 align-middle shadow-[0_0_6px_rgba(129,140,248,0.9)]" />}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="px-4 pt-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center text-xs text-slate-500">
            Workbook load ho raha hai...
          </div>
        </div>
      )}

      {/* FRESH DAY indicator — aaj ki sheet par (roz naya date 0 se start) */}
      {isTodaySheet && (
        <div className="px-4 pt-2">
          <div className="flex flex-wrap items-center gap-x-3 rounded-lg border border-indigo-400/30 bg-gradient-to-r from-indigo-500/20 via-indigo-500/5 to-transparent px-3.5 py-2 text-[11px] font-bold text-indigo-200 ring-1 ring-inset ring-indigo-300/10">
            <span className="font-black tracking-wider">FRESH DAY — DAY {dayNumForHeader}</span>
            <span className="font-semibold text-indigo-400/70">All counters started at 0 • Opening Cash In Hand 200 + 200 (chart)</span>
          </div>
        </div>
      )}

      {/* Excel Sheet Table View */}
      {loadingSheet ? (
        <div className="px-4 pt-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-10 text-center text-xs text-slate-500">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"></div>
            <p className="font-semibold">Loading sheet "{activeSheetName}"...</p>
          </div>
        </div>
      ) : liveGrid.length === 0 ? (
        <div className="px-4 pt-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-10 text-center text-xs text-slate-500">
            Sheet data load nahi ho saka ya khali hai.
          </div>
        </div>
      ) : (
        <div className="px-4 pb-8 pt-3">
          {/* Excel grid card — white sheet exactly like the file (bilkul XL), navy chrome ke andar */}
          <div className="overflow-hidden rounded-b-xl rounded-tr-xl border border-slate-700/70 bg-white shadow-2xl shadow-black/40">
            <div className="xl-scroll overflow-auto bg-white" style={{ maxHeight: 'calc(100vh - 140px)' }}>
              <table
                className="w-max select-text border-collapse bg-white"
                style={{ minWidth: '100%', fontFamily: "'Comfortaa', 'Segoe UI', sans-serif" }}
              >
                {/* Sticky Column Headers: Row 0 / Column Letters */}
                <thead className="sticky top-0 z-20 bg-gray-100 shadow-sm">
                  <tr>
                    <th className="sticky left-0 z-30 w-12 shrink-0 border border-gray-300 bg-gray-100 px-1 py-0.5 text-center font-mono text-[10px] font-bold text-gray-700"></th>
                    {Array.from({ length: visibleColCount }).map((_, c) => {
                      const wch = currentSheet?.cols?.[c];
                      const widthPx = isDaySheet
                        ? (CANON_COL_WIDTHS_PX[c] ?? 93)
                        : wch
                        ? Math.round(wch * 7) + 5
                        : 93;
                      return (
                        <th
                          key={c}
                          style={{ width: `${widthPx}px`, minWidth: `${widthPx}px` }}
                          className="border border-gray-300 bg-gray-100 px-1 py-0.5 text-center font-mono text-[10px] font-bold text-gray-700"
                        >
                          {colToLetter(c)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                {/* Table Body */}
                <tbody>
                  {liveGrid.map((row, r) => (
                    <tr key={r} className="hover:opacity-95 transition-opacity" style={{ height: r === 0 ? 47 : 26 }}>
                      <td className="sticky left-0 z-10 shrink-0 border border-gray-300 bg-gray-100 px-1 py-0.5 text-center font-mono text-[10px] font-semibold text-gray-600">
                        {r + 1}
                      </td>

                      {row.slice(0, visibleColCount).map((val, c) => {
                        const mergeKey = `${r},${c}`;
                        const mergeInfo = mergeMap.get(mergeKey);

                        if (mergeInfo?.isCovered) {
                          return null;
                        }

                        const computed = isComputedCell(r, c);

                        let styleObj: any = null;
                        if (isDaySheet) {
                          const ci = CANON_INDEX[r]?.[c];
                          styleObj = (ci !== null && ci !== undefined) ? CANON_TABLE[ci] : null;
                        } else {
                          const styleIdx = currentSheet?.styleIndex?.[r]?.[c];
                          styleObj = (styleIdx !== null && styleIdx !== undefined && currentSheet?.styleTable)
                            ? currentSheet.styleTable[styleIdx]
                            : null;
                        }

                        const bgColor = colorToCss(styleObj?.fill?.fgColor) ?? '#ffffff';
                        const fontColor = colorToCss(styleObj?.font?.color) ?? '#000000';
                        const fontWeight = styleObj?.font?.bold ? 'bold' : 'normal';
                        const fontStyle = styleObj?.font?.italic ? 'italic' : 'normal';
                        const fontSize = styleObj?.font?.sz ? `${Math.round(styleObj.font.sz * 1.33)}px` : '13px';
                        const textAlign = styleObj?.alignment?.horizontal ?? (isNumericValue(val) ? 'right' : 'left');
                        const whiteSpace = styleObj?.alignment?.wrapText ? 'normal' : 'nowrap';

                        const borderTop = styleObj?.border?.top ? `1px solid ${colorToCss(styleObj.border.top.color) ?? '#d4d4d8'}` : '1px solid #d4d4d8';
                        const borderBottom = styleObj?.border?.bottom ? `1px solid ${colorToCss(styleObj.border.bottom.color) ?? '#d4d4d8'}` : '1px solid #d4d4d8';
                        const borderLeft = styleObj?.border?.left ? `1px solid ${colorToCss(styleObj.border.left.color) ?? '#d4d4d8'}` : '1px solid #d4d4d8';
                        const borderRight = styleObj?.border?.right ? `1px solid ${colorToCss(styleObj.border.right.color) ?? '#d4d4d8'}` : '1px solid #d4d4d8';

                        let displayVal: string | number | null = val;
                        if (val === null || val === undefined) {
                          displayVal = '';
                        } else if (typeof val === 'number') {
                          if (styleObj?.numFmt && typeof styleObj.numFmt === 'string') {
                            try {
                              displayVal = XLSX.SSF.format(styleObj.numFmt, val);
                            } catch {
                              displayVal = Number.isInteger(val) ? val.toLocaleString('en-IN') : val.toFixed(2);
                            }
                          } else {
                            displayVal = Number.isInteger(val) ? val.toLocaleString('en-IN') : val.toFixed(2);
                          }
                        }

                        let effectiveColSpan = mergeInfo?.colSpan;
                        if (effectiveColSpan && c + effectiveColSpan > visibleColCount) {
                          effectiveColSpan = visibleColCount - c;
                        }

                        return (
                          <td
                            key={c}
                            rowSpan={mergeInfo?.rowSpan && mergeInfo.rowSpan > 1 ? mergeInfo.rowSpan : undefined}
                            colSpan={effectiveColSpan && effectiveColSpan > 1 ? effectiveColSpan : undefined}
                            onClick={() => handleCellClick(r, c)}
                            title={`${cellToA1(r, c)}: ${val ?? ''}${computed ? ' (Auto-computed)' : ' (Click to edit)'}`}
                            className="cursor-pointer select-text overflow-hidden px-1 py-[1px] align-middle hover:opacity-90"
                            style={{
                              backgroundColor: bgColor,
                              color: fontColor,
                              fontFamily: styleObj?.font?.name ? `'${styleObj.font.name}', 'Comfortaa', sans-serif` : "'Comfortaa', 'Segoe UI', sans-serif",
                              fontWeight,
                              fontStyle,
                              fontSize,
                              lineHeight: 1.15,
                              textAlign: textAlign as any,
                              whiteSpace: whiteSpace as any,
                              borderTop,
                              borderBottom,
                              borderLeft,
                              borderRight
                            }}
                          >
                            {editingCell && editingCell.row === r && editingCell.col === c ? (
                              editingCell.col === 5 || editingCell.col === 4 || editingCell.col === 12 || editingCell.col === 16 ? (
                                <select
                                  autoFocus
                                  value={editingCell.value}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => handleSaveCell(e.target.value)}
                                  onBlur={() => handleSaveCell()}
                                  className="m-0 w-full cursor-pointer border-0 bg-transparent p-0 outline-none"
                                  style={{ fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', fontStyle: 'inherit', color: 'inherit', backgroundColor: 'transparent', textAlign: textAlign as any }}
                                >
                                  <option value="">(Blank)</option>
                                  {(editingCell.col === 5 ? ['Cash', 'Receipt'] : editingCell.col === 16 ? ['Transport', 'Courior', 'In Hand', 'Other Party', 'Riksha'] : ['1', '2']).map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  autoFocus
                                  value={editingCell.value}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveCell();
                                    if (e.key === 'Escape') setEditingCell(null);
                                  }}
                                  onBlur={() => handleSaveCell()}
                                  className="m-0 w-full border-0 bg-transparent p-0 outline-none"
                                  style={{ fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', fontStyle: 'inherit', color: 'inherit', backgroundColor: 'transparent', textAlign: textAlign as any }}
                                />
                              )
                            ) : (
                              String(displayVal)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

