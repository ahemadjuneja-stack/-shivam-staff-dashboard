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
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import {
  SheetData,
  MonthDoc,
  cellToA1,
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

// Boss order 2026-10-27: parcel side ki HG line (column W) REMOVE — render-hide.
// Grid data me col 22 INTACT rehta hai (formulas / XL export / saves untouched).
const HG_COL = 22;

// ============================================================
// SHIVAM CASH COUNTER — MIDNIGHT LUXE THEME (Task 75)
// Boss: 'abhi bhi maza nahi aa raha, muje jaisa chahiye waisa nahi' —
// Task 74 ki flat muddy navy palette ka poora replacement. Ab VIVID
// jewel-glass design: har section ki apni rich saturated identity
// (sapphire bill area / emerald dept box / royal violet Cash Given /
// bronze parcel side), har cell me glass depth (top-light gradient),
// bright glow text, sapphire-glow header strip. Boss rule same:
// 'line/box/calculation PURANE rahenge' — boxes/lines/merges/rows/cols
// positions EXACT same, calculation untouched. Grid data / formulas /
// XL export 100% untouched — sirf screen colors.
// ============================================================
const GRID_BORDER = '#31427e';   // indigo hairline grid lines (boxes position SAME)
const SECTION_EDGE = '#6d85e0';  // glowing section boundary accent line

const PREMIUM = {
  base: 'linear-gradient(180deg, #1b2a62 0%, #121c44 100%)',      // sapphire glass
  baseAlt: 'linear-gradient(180deg, #223472 0%, #182552 100%)',   // zebra lighter glass
  deptBox: 'linear-gradient(180deg, #0e5f47 0%, #093d2d 100%)',   // emerald glass — department details (A-C)
  cashGiven: 'linear-gradient(180deg, #4b2b96 0%, #2f1c66 100%)', // royal violet glass — Cash Given side (M-P)
  parcel: 'linear-gradient(180deg, #7d4e12 0%, #57360c 100%)',    // bronze glass — parcel side (Q-AB)
  headerGrad: 'linear-gradient(115deg, #2d52b0 0%, #1c2f6e 30%, #2a4c9e 55%, #16255c 80%, #2d52b0 100%)' // sapphire glow header
};

// Canon accent fills -> premium glow accents (section identity same rehti hai)
const CANON_BG_MAP: Record<string, string> = {
  '073763': PREMIUM.headerGrad,                                  // navy headers -> sapphire glow gradient
  '274E13': 'linear-gradient(180deg, #0f7254 0%, #0a4a37 100%)', // dark green -> emerald jewel gradient
  '38761D': '#12765a', // green -> emerald
  '783F04': '#6f4715', // brown -> bronze
  '4C1130': '#5f1c49', // maroon -> wine jewel
  'EAD1DC': '#4e2570', // pink band -> orchid
  'B6D7A8': '#0e6b4f', // green band -> emerald
  'D9EAD3': '#128767', // green band light -> bright emerald
  'E06666': '#822350', // red -> rose jewel
  'E6B8AF': '#6d2a44', // light red -> rose deep
  'BF9000': '#856111', // gold -> amber
  'FFD966': '#98751a', // yellow -> bright gold
  'FFF2CC': '#6b5518', // cream -> soft amber
  'EBEFF1': '#1c2a5c', // light gray -> alt navy
  'FFFFFF': ''         // white -> section glass (zebra/section)
};

// Canon font colors -> premium light accents
const CANON_FG_MAP: Record<string, string> = {
  '000000': '#eaf0ff',
  '0C343D': '#8fd8f8',
  '073763': '#9db9ff',
  '4C1130': '#ffabe0',
  '660000': '#ffa5a5',
  '7F6000': '#ffd76a',
  'C27BA0': '#f5b3ff',
  'FF0000': '#ff9fb2',
  '0000FF': '#9cc6ff',
  'FFFFFF': '#f7faff',
  'EFEFEF': '#eaeffc',
  'EAD1DC': '#f3c9f0'
};

// Section-aware jewel-glass background — structure/lines EXACT same, sirf colors
const sectionCellBg = (r: number, c: number, canonColor: string | null): string => {
  if (canonColor) {
    const mapped = CANON_BG_MAP[canonColor.replace('#', '').toUpperCase()];
    if (mapped) return mapped;
  }
  if (r === 0) return PREMIUM.headerGrad;           // glowing header strip
  if (c <= 2) return PREMIUM.deptBox;               // department details box
  if (c >= 12 && c <= 15) return PREMIUM.cashGiven; // office Cash Given side
  if (c >= 16) return PREMIUM.parcel;               // parcel register side
  return r % 2 === 1 ? PREMIUM.baseAlt : PREMIUM.base; // zebra rows
};

const sectionCellFont = (r: number, c: number, canonColor: string | null, computed: boolean): string => {
  if (computed) return '#8bf3c4';                   // formula cells — emerald glow
  if (canonColor) {
    const mapped = CANON_FG_MAP[canonColor.replace('#', '').toUpperCase()];
    if (mapped) return mapped;
  }
  if (r === 0) return '#f4f8ff';                    // header text
  if (c <= 2) return '#d9f6e8';                     // dept box — mint
  if (c >= 12 && c <= 15) return '#efe6ff';         // cash given — lavender
  if (c >= 16) return '#ffedcb';                    // parcel — warm cream
  return '#e9efff';
};

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

  // Active sheet grid (day sheets = formula-engine processed)
  const liveGrid = useMemo<CellValue[][]>(() => {
    if (!currentSheet || !currentSheet.grid || currentSheet.grid.length === 0) return [];
    return isDaySheetName(activeSheetName) ? runFormulaEngine(currentSheet.grid).grid : currentSheet.grid;
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

  // ===== Website-style navigation buttons (Boss: 'button add karo website jaisa banao') =====
  const dayNav = (dir: -1 | 1) => {
    if (sortedSheetNames.length === 0) return;
    const idx = sortedSheetNames.indexOf(activeSheetName);
    if (idx < 0) return;
    const next = sortedSheetNames[Math.min(sortedSheetNames.length - 1, Math.max(0, idx + dir))];
    if (next && next !== activeSheetName) setActiveSheetName(next);
  };
  const jumpToday = () => {
    if (selectedMonthId !== realMonthId()) {
      setSelectedMonthId(realMonthId());
      setSheetsCache({});
    }
    setActiveSheetName(todayDayStr());
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

      {/* ===== PREMIUM PRODUCT HEADER (company website style — Boss: 'professional company style') ===== */}
      <div className="border-b border-slate-800/70 bg-gradient-to-r from-slate-950 via-[#0d1b3a] to-slate-950">
        <div className="h-[2px] w-full flow-line bg-gradient-to-r from-emerald-400 via-indigo-400 via-violet-400 to-emerald-400" />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-700 shadow-lg shadow-emerald-500/30 ring-1 ring-emerald-300/40">
              <FileSpreadsheet className="h-6 w-6 text-white" />
            </div>
            <div className="leading-tight">
              <h1 className="shivam-silver shivam-silver-shine-slow text-2xl font-black tracking-[0.06em]">CASH COUNTER</h1>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300/80">Daily Excel Accounts — Chart /10</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-black tracking-wider text-emerald-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              LIVE SYNC
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/40 bg-gradient-to-r from-indigo-500/20 via-violet-500/15 to-indigo-500/20 px-3 py-1.5 text-[10px] font-black tracking-wider text-indigo-200 ring-1 ring-inset ring-indigo-300/20">
              <Calendar className="h-3 w-3" />
              TODAY • {todayLabel}
            </span>
            <button
              onClick={handleDownloadWorkbook}
              disabled={!currentMonth || !selectedMonthId}
              className="btn-shine btn-pulse flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 ring-1 ring-emerald-300/40 transition-all hover:-translate-y-px hover:from-emerald-400 hover:to-teal-500 hover:shadow-xl hover:shadow-emerald-500/40 disabled:translate-y-0 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              <span>XL Download</span>
            </button>
          </div>
        </div>
      </div>

      {/* ===== CONTROL TOOLBAR (sticky website-style button bar) ===== */}
      <div className="sticky top-0 z-40 border-b border-slate-700/60 bg-slate-950/90 shadow-lg shadow-black/20 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2">
          {/* Month Selector Dropdown */}
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

          <span className="mx-1 hidden h-5 w-px bg-slate-700/70 sm:block" />

          {/* Day navigation buttons — pichli / agli sheet */}
          <button
            onClick={() => dayNav(-1)}
            title="Pichli sheet"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-600/70 bg-gradient-to-b from-slate-800 to-slate-900 text-slate-300 ring-1 ring-white/5 transition hover:border-emerald-400/40 hover:from-slate-700 hover:text-emerald-300 hover:shadow-lg hover:shadow-emerald-500/20 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => dayNav(1)}
            title="Agli sheet"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-600/70 bg-gradient-to-b from-slate-800 to-slate-900 text-slate-300 ring-1 ring-white/5 transition hover:border-emerald-400/40 hover:from-slate-700 hover:text-emerald-300 hover:shadow-lg hover:shadow-emerald-500/20 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={jumpToday}
            title="Aaj ki sheet par jump karo (fresh 0)"
            className="btn-shine flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3 text-[11px] font-black tracking-wide text-white shadow-lg shadow-indigo-600/25 ring-1 ring-indigo-300/30 transition-all hover:-translate-y-px hover:shadow-xl disabled:opacity-40"
          >
            <Calendar className="h-3.5 w-3.5" />
            TODAY
          </button>
          <button
            onClick={() => fetchMonths(false, selectedMonthId)}
            title="Refresh Months"
            disabled={loadingMonths}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-600/70 bg-gradient-to-b from-slate-800 to-slate-900 text-slate-300 ring-1 ring-white/5 transition hover:border-emerald-400/40 hover:from-slate-700 hover:text-emerald-300 hover:shadow-lg hover:shadow-emerald-500/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingMonths ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Offline-first banner (OFFLINE / SYNC PENDING) */}
      <div className="px-4 pt-3">
        <OutboxBanner />
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
                      ? 'bg-gradient-to-b from-[#14225a] to-[#0d1740] font-bold text-emerald-300 shadow-[inset_0_2px_0_0_rgb(52_211_153),0_0_28px_rgba(52,211,153,0.3)]'
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
        <div className="relative px-4 pb-8 pt-3">
          {/* Ambient premium glow — drifting aurora blobs (screen ko XL-copy se PRODUCT banata hai) */}
          <div className="pointer-events-none absolute -top-8 left-16 h-44 w-44 rounded-full bg-emerald-500/15 blur-3xl" style={{ animation: 'blobDrift 9s ease-in-out infinite' }} />
          <div className="pointer-events-none absolute right-24 top-10 h-52 w-52 rounded-full bg-indigo-500/15 blur-3xl" style={{ animation: 'blobDrift 11s ease-in-out infinite 1.2s' }} />
          <div className="pointer-events-none absolute bottom-10 left-1/3 h-40 w-40 rounded-full bg-violet-500/10 blur-3xl" style={{ animation: 'blobDrift 13s ease-in-out infinite 0.6s' }} />
          {/* MIDNIGHT LUXE grid card — animated aurora border frame (data/formulas untouched) */}
          <div className="aurora-frame relative rounded-b-xl rounded-tr-xl shadow-[0_24px_90px_-24px_rgba(16,185,129,0.28)]">
            <div className="relative z-10 bg-gradient-to-b from-[#0c1428] to-[#0a1122]">
            <div className="xl-scroll overflow-auto" style={{ maxHeight: 'calc(100vh - 140px)' }}>
              <table
                className="w-max select-text border-collapse"
                style={{ minWidth: '100%', fontFamily: "'Comfortaa', 'Segoe UI', sans-serif" }}
              >
                {/* Invisible width-holder strip — Boss order: side ke 1-2-3-4 row numbers
                    + upar A-B-C-D column letters REMOVE (sirf column width hints bache) */}
                <thead>
                  <tr>
                    {Array.from({ length: visibleColCount }).map((_, c) => {
                      if (c === HG_COL) return null;
                      const wch = currentSheet?.cols?.[c];
                      const widthPx = isDaySheet
                        ? (CANON_COL_WIDTHS_PX[c] ?? 93)
                        : wch
                        ? Math.round(wch * 7) + 5
                        : 93;
                      return (
                        <th
                          key={c}
                          style={{ width: `${widthPx}px`, minWidth: `${widthPx}px`, height: 0, padding: 0, border: 'none', backgroundColor: 'transparent' }}
                        />
                      );
                    })}
                  </tr>
                </thead>

                {/* Table Body */}
                <tbody>
                  {liveGrid.map((row, r) => (
                    <tr key={r} className="xl-row" style={{ height: r === 0 ? 47 : 26 }}>
                      {row.slice(0, visibleColCount).map((val, c) => {
                        if (c === HG_COL) return null; // Boss: HG line remove

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

                        const bgColor = sectionCellBg(r, c, colorToCss(styleObj?.fill?.fgColor));
                        const fontColor = sectionCellFont(r, c, colorToCss(styleObj?.font?.color), computed);
                        // Formula cells — emerald wash overlay (premium auto-glow)
                        const bgFinal = computed ? `linear-gradient(rgba(110,231,183,0.13), rgba(110,231,183,0.13)), ${bgColor}` : bgColor;
                        const fontWeight = computed ? 'bold' : styleObj?.font?.bold ? 'bold' : 'normal';
                        const fontStyle = styleObj?.font?.italic ? 'italic' : 'normal';
                        const fontSize = styleObj?.font?.sz ? `${Math.round(styleObj.font.sz * 1.33)}px` : '13px';
                        const textAlign = styleObj?.alignment?.horizontal ?? (isNumericValue(val) ? 'right' : 'left');
                        const whiteSpace = styleObj?.alignment?.wrapText ? 'normal' : 'nowrap';
                        // Header strip cells — animated sapphire sheen (screen zinda rahe)
                        const isHdrCell = bgColor === PREMIUM.headerGrad;

                        // Premium hairline grid lines — position EXACT same (Boss rule);
                        // section boundaries par stronger accent line = premium separation
                        const isSectionEdge = c === 3 || c === 12 || c === 16;
                        const borderTop = `1px solid ${GRID_BORDER}`;
                        const borderBottom = `1px solid ${GRID_BORDER}`;
                        const borderLeft = isSectionEdge ? `2px solid ${SECTION_EDGE}` : `1px solid ${GRID_BORDER}`;
                        const borderRight = `1px solid ${GRID_BORDER}`;

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
                            className={`xl-cell cursor-pointer select-text overflow-hidden px-1 py-[1px] align-middle ${isHdrCell ? 'hdr-anim' : ''} ${computed ? 'cell-glow' : ''}`}
                            style={{
                              background: bgFinal,
                              color: fontColor,
                              fontFamily: styleObj?.font?.name ? `'${styleObj.font.name}', 'Comfortaa', sans-serif` : "'Comfortaa', 'Segoe UI', sans-serif",
                              fontWeight,
                              fontStyle,
                              fontSize,
                              lineHeight: 1.15,
                              fontVariantNumeric: 'tabular-nums',
                              textShadow: isHdrCell ? '0 1px 12px rgba(147,180,255,0.55)' : undefined,
                              letterSpacing: r === 0 ? '0.05em' : undefined,
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
                                    <option key={opt} value={opt} className="bg-[#101b3e] text-slate-100">{opt}</option>
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
                                  style={{ fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', fontStyle: 'inherit', color: 'inherit', backgroundColor: 'transparent', caretColor: '#34d399', textAlign: textAlign as any }}
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
        </div>
      )}

    </div>
  );
}

