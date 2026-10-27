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
// SHIVAM CASH COUNTER — LIGHT PREMIUM MONEY-APP THEME (Task 76)
// Boss ne choose kiya: LIGHT look + SOFT MODERN grid + Paytm Business
// reference + mobile smart-fit. Dark palettes (T73/74/75) full replace.
// - Grid boxes: position/count SAME, par ab rounded soft tiles with
//   spacing (border-separate) — Excel-cell feel gayab, modern app tiles.
// - Sections: white/ivory glass + soft tints (emerald dept box / gold
//   Cash Given / sky parcel) + deep blue header strip (money-app look).
// - Numbers: bold tabular — Paytm jaise bade amounts feel.
// - Boss rule same: line/box/calculation data EXACT purana — grid data /
//   formulas / merges / XL export 100% untouched, sirf screen colors.
// ============================================================
const GRID_BORDER = '#dfe6f3';   // soft tile border (boxes position SAME)
const SECTION_EDGE = '#a9bde4';  // section boundary accent line
const TILE_RADIUS = 8;           // rounded soft tiles

const PREMIUM = {
  base: 'linear-gradient(180deg, #ffffff 0%, #f6f9fe 100%)',      // white glass
  baseAlt: 'linear-gradient(180deg, #fbfcff 0%, #f2f6fd 100%)',   // zebra soft blue
  deptBox: 'linear-gradient(180deg, #e9f9f1 0%, #d9f2e6 100%)',   // emerald tint — department details (A-C)
  cashGiven: 'linear-gradient(180deg, #fef6e0 0%, #fdeec4 100%)', // gold tint — Cash Given side (cash = gold)
  parcel: 'linear-gradient(180deg, #eaf5fe 0%, #dcecfc 100%)',    // sky tint — parcel side (Q-AB)
  headerGrad: 'linear-gradient(135deg, #1e3a8a 0%, #2456d6 55%, #1d4ed8 100%)' // money-app blue header
};

// Canon accent fills -> soft light tints (section identity preserve)
const CANON_BG_MAP: Record<string, string> = {
  '073763': PREMIUM.headerGrad,                                  // navy headers -> money-app blue gradient
  '274E13': 'linear-gradient(180deg, #e3f8ee 0%, #d2f2e3 100%)', // dark green -> emerald tint
  '38761D': '#e0f6ec', // green -> emerald tint
  '783F04': '#fdf1d9', // brown -> gold tint
  '4C1130': '#fde9f1', // maroon -> rose tint
  'EAD1DC': '#fbeef4', // pink band -> soft rose
  'B6D7A8': '#e4f7ec', // green band -> emerald tint
  'D9EAD3': '#dcf8ea', // green band light -> brighter emerald tint
  'E06666': '#fee5e5', // red -> soft rose
  'E6B8AF': '#feecec', // light red -> rose tint
  'BF9000': '#fdf2d7', // gold -> gold tint
  'FFD966': '#fef3cf', // yellow -> bright gold tint
  'FFF2CC': '#fef9e3', // cream -> soft gold
  'EBEFF1': '#f1f5fb', // light gray -> gray-blue tint
  'FFFFFF': ''         // white -> section glass
};

// Canon font colors -> light-theme readable accents
const CANON_FG_MAP: Record<string, string> = {
  '000000': '#1e293b',
  '0C343D': '#0e7490',
  '073763': '#1d4ed8',
  '4C1130': '#9d174d',
  '660000': '#b91c1c',
  '7F6000': '#a16207',
  'C27BA0': '#be185d',
  'FF0000': '#dc2626',
  '0000FF': '#2563eb',
  'FFFFFF': '#ffffff',
  'EFEFEF': '#334155',
  'EAD1DC': '#9d174d'
};

// Dark canon fills par original white font hota tha — light tints par white
// text padhta nahi, isliye per-fill dark accent text (fill ke saath match)
const DARK_FILL_FONT: Record<string, string> = {
  '073763': '#ffffff',
  '274E13': '#065f46',
  '38761D': '#047857',
  '4C1130': '#9d174d',
  '783F04': '#92400e',
  'E06666': '#b91c1c'
};

// Section-aware light glass background — structure/lines EXACT same, sirf colors
const sectionCellBg = (r: number, c: number, canonColor: string | null): string => {
  if (canonColor) {
    const mapped = CANON_BG_MAP[canonColor.replace('#', '').toUpperCase()];
    if (mapped) return mapped;
  }
  if (r === 0) return PREMIUM.headerGrad;           // money-app blue header strip
  if (c <= 2) return PREMIUM.deptBox;               // department details box
  if (c >= 12 && c <= 15) return PREMIUM.cashGiven; // office Cash Given side (gold)
  if (c >= 16) return PREMIUM.parcel;               // parcel register side (sky)
  return r % 2 === 1 ? PREMIUM.baseAlt : PREMIUM.base; // zebra white rows
};

const sectionCellFont = (r: number, c: number, canonFill: string | null, canonFontColor: string | null, computed: boolean): string => {
  if (computed) return '#047857';                   // formula cells — money green
  if (canonFill) {
    const dk = DARK_FILL_FONT[canonFill.replace('#', '').toUpperCase()];
    if (dk) return dk;
  }
  if (r === 0) return '#ffffff';                    // header text on blue
  if (canonFontColor) {
    const mapped = CANON_FG_MAP[canonFontColor.replace('#', '').toUpperCase()];
    if (mapped) return mapped;
  }
  if (c <= 2) return '#065f46';                     // dept box — emerald-800
  if (c >= 12 && c <= 15) return '#92400e';         // cash given — amber-800
  if (c >= 16) return '#0c4a6e';                    // parcel — sky-900
  return '#1e293b';
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

  // Mobile smart-fit (Boss: dono par perfect) — phone par columns narrow + font compact
  const [isMobile, setIsMobile] = useState<boolean>(typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
    <div className="hisab-fullbleed flex min-h-screen flex-col bg-gradient-to-b from-[#f5f8fd] via-[#eff4fb] to-[#e9eef9] text-slate-800">
      {/* Toast Notification (light money-app style) */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border px-5 py-3.5 shadow-xl shadow-slate-900/10 ring-1 ring-black/5 backdrop-blur-md text-xs font-bold transition-all ${
            toast.type === 'success'
              ? 'border-emerald-500/40 bg-white text-emerald-700'
              : toast.type === 'error'
              ? 'border-rose-500/40 bg-white text-rose-700'
              : 'border-indigo-500/40 bg-white text-indigo-700'
          }`}
        >
          {toast.type === 'success' ? (
            <Check className="h-4 w-4 text-emerald-500" />
          ) : toast.type === 'error' ? (
            <AlertCircle className="h-4 w-4 text-rose-500" />
          ) : (
            <Calculator className="h-4 w-4 text-indigo-500" />
          )}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-400 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ===== LIGHT MONEY-APP HEADER (Paytm Business style — Boss choice) ===== */}
      <div className="border-b border-slate-200/80 bg-white/85 backdrop-blur">
        <div className="h-[2px] w-full flow-line bg-gradient-to-r from-emerald-400 via-indigo-400 via-violet-400 to-emerald-400" />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-500/30 ring-1 ring-emerald-300/50">
              <FileSpreadsheet className="h-6 w-6 text-white" />
            </div>
            <div className="leading-tight">
              <h1 className="cash-title text-2xl font-black tracking-[0.06em]">CASH COUNTER</h1>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-600">Daily Excel Accounts — Chart /10</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-50 px-3 py-1.5 text-[10px] font-black tracking-wider text-emerald-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              LIVE SYNC
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-50 px-3 py-1.5 text-[10px] font-black tracking-wider text-blue-700 ring-1 ring-inset ring-blue-300/30">
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

      {/* ===== CONTROL TOOLBAR (sticky light money-app bar) ===== */}
      <div className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 shadow-sm shadow-slate-900/5 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2">
          {/* Month Selector Dropdown */}
          <select
            value={selectedMonthId}
            onChange={(e) => {
              setSelectedMonthId(e.target.value);
              setSheetsCache({});
            }}
            disabled={loadingMonths || months.length === 0}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-sm transition hover:border-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/25 focus:outline-none disabled:opacity-50"
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

          <span className="mx-1 hidden h-5 w-px bg-slate-300 sm:block" />

          {/* Day navigation buttons — pichli / agli sheet */}
          <button
            onClick={() => dayNav(-1)}
            title="Pichli sheet"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 shadow-sm transition hover:border-emerald-400 hover:text-emerald-600 hover:shadow-lg hover:shadow-emerald-500/20 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => dayNav(1)}
            title="Agli sheet"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 shadow-sm transition hover:border-emerald-400 hover:text-emerald-600 hover:shadow-lg hover:shadow-emerald-500/20 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={jumpToday}
            title="Aaj ki sheet par jump karo (fresh 0)"
            className="btn-shine flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 text-[11px] font-black tracking-wide text-white shadow-lg shadow-blue-600/25 ring-1 ring-blue-300/30 transition-all hover:-translate-y-px hover:shadow-xl disabled:opacity-40"
          >
            <Calendar className="h-3.5 w-3.5" />
            TODAY
          </button>
          <button
            onClick={() => fetchMonths(false, selectedMonthId)}
            title="Refresh Months"
            disabled={loadingMonths}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 shadow-sm transition hover:border-emerald-400 hover:text-emerald-600 hover:shadow-lg hover:shadow-emerald-500/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingMonths ? 'animate-spin text-blue-500' : ''}`} />
          </button>
        </div>
      </div>

      {/* Offline-first banner (OFFLINE / SYNC PENDING) */}
      <div className="px-4 pt-3">
        <OutboxBanner />
      </div>

      {/* Day Tabs Bar (light pill tabs — money-app style) */}
      {sortedSheetNames.length > 0 ? (
        <div className="px-4 pt-3">
          <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl bg-white/70 p-1.5 shadow-sm ring-1 ring-slate-200/80 backdrop-blur">
            {sortedSheetNames.map((name) => {
              const isSelected = activeSheetName === name;
              const isTodayTab = selectedMonthId === realMonthId() && name === todayDayStr();
              return (
                <button
                  key={name}
                  onClick={() => setActiveSheetName(name)}
                  title={isTodayTab ? 'Aaj ka din — fresh 0 se start' : isDaySheetName(name) ? `Day ${name}` : 'Haste & Reminder'}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                    isSelected
                      ? 'bg-white font-bold text-emerald-600 shadow-[0_4px_14px_-6px_rgba(15,40,90,0.35),inset_0_2px_0_0_rgb(16,185,129)] ring-1 ring-slate-200/70'
                      : isTodayTab
                      ? 'text-blue-600 hover:bg-white/80'
                      : 'text-slate-500 hover:bg-white/80'
                  }`}
                >
                  {name}
                  {isTodayTab && <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 align-middle shadow-[0_0_6px_rgba(59,130,246,0.9)]" />}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="px-4 pt-3">
          <div className="rounded-xl border border-slate-200 bg-white/70 p-6 text-center text-xs text-slate-500">
            Workbook load ho raha hai...
          </div>
        </div>
      )}

      {/* FRESH DAY indicator — aaj ki sheet par (roz naya date 0 se start) */}
      {isTodaySheet && (
        <div className="px-4 pt-2">
          <div className="flex flex-wrap items-center gap-x-3 rounded-lg border border-blue-400/40 bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-transparent px-3.5 py-2 text-[11px] font-bold text-blue-800 ring-1 ring-inset ring-blue-300/30">
            <span className="font-black tracking-wider">FRESH DAY — DAY {dayNumForHeader}</span>
            <span className="font-semibold text-blue-500/80">All counters started at 0 • Opening Cash In Hand 200 + 200 (chart)</span>
          </div>
        </div>
      )}

      {/* Excel Sheet Table View */}
      {loadingSheet ? (
        <div className="px-4 pt-3">
          <div className="rounded-xl border border-slate-200 bg-white/70 p-10 text-center text-xs text-slate-500">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
            <p className="font-semibold">Loading sheet "{activeSheetName}"...</p>
          </div>
        </div>
      ) : liveGrid.length === 0 ? (
        <div className="px-4 pt-3">
          <div className="rounded-xl border border-slate-200 bg-white/70 p-10 text-center text-xs text-slate-500">
            Sheet data load nahi ho saka ya khali hai.
          </div>
        </div>
      ) : (
        <div className="relative px-4 pb-8 pt-3">
          {/* Ambient soft glow blobs — light theme par pastel depth.
              BATTERY FIX 27 Oct: blur-3xl (64px GPU filter) ki jagah
              radial-gradient — SAME soft look, filter cost ZERO.
              blobDrift transform/opacity animation = compositor-only, cheap. */}
          <div className="pointer-events-none absolute -top-8 left-16 h-44 w-44" style={{ background: 'radial-gradient(circle closest-side, rgba(52, 211, 153, 0.28) 0%, rgba(52, 211, 153, 0) 72%)', animation: 'blobDrift 9s ease-in-out infinite' }} />
          <div className="pointer-events-none absolute right-24 top-10 h-52 w-52" style={{ background: 'radial-gradient(circle closest-side, rgba(96, 165, 250, 0.28) 0%, rgba(96, 165, 250, 0) 72%)', animation: 'blobDrift 11s ease-in-out infinite 1.2s' }} />
          <div className="pointer-events-none absolute bottom-10 left-1/3 h-40 w-40" style={{ background: 'radial-gradient(circle closest-side, rgba(167, 139, 250, 0.24) 0%, rgba(167, 139, 250, 0) 72%)', animation: 'blobDrift 13s ease-in-out infinite 0.6s' }} />
          {/* LIGHT MONEY-APP grid card — white glass, soft shadow, top accent strip */}
          <div className="relative overflow-hidden rounded-2xl bg-white shadow-[0_24px_70px_-28px_rgba(15,40,90,0.35)] ring-1 ring-slate-200/80">
            <div className="h-[3px] w-full flow-line bg-gradient-to-r from-emerald-400 via-blue-400 via-violet-400 to-emerald-400" />
            <div className="xl-scroll overflow-auto" style={{ maxHeight: 'calc(100vh - 140px)' }}>
              <table
                className="w-max select-text"
                style={{ minWidth: '100%', fontFamily: "'Comfortaa', 'Segoe UI', sans-serif", borderCollapse: 'separate', borderSpacing: isMobile ? '2px' : '3px' }}
              >
                {/* Invisible width-holder strip — Boss order: side ke 1-2-3-4 row numbers
                    + upar A-B-C-D column letters REMOVE (sirf column width hints bache) */}
                <thead>
                  <tr>
                    {Array.from({ length: visibleColCount }).map((_, c) => {
                      if (c === HG_COL) return null;
                      const wch = currentSheet?.cols?.[c];
                      const basePx = isDaySheet
                        ? (CANON_COL_WIDTHS_PX[c] ?? 93)
                        : wch
                        ? Math.round(wch * 7) + 5
                        : 93;
                      // Phone smart-fit — mobile par columns 22% narrow (zyada area dikhe)
                      const widthPx = Math.round(basePx * (isMobile ? 0.78 : 1));
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

                        const canonFill = colorToCss(styleObj?.fill?.fgColor);
                        const canonFontC = colorToCss(styleObj?.font?.color);
                        const bgColor = sectionCellBg(r, c, canonFill);
                        const fontColor = sectionCellFont(r, c, canonFill, canonFontC, computed);
                        // Formula cells — money-green wash overlay (Paytm highlight feel)
                        const bgFinal = computed ? `linear-gradient(rgba(16,185,129,0.12), rgba(16,185,129,0.12)), ${bgColor}` : bgColor;
                        const fontWeight = computed ? 'bold' : isNumericValue(val) ? 700 : styleObj?.font?.bold ? 'bold' : 'normal';
                        const fontStyle = styleObj?.font?.italic ? 'italic' : 'normal';
                        const fontSize = styleObj?.font?.sz ? `${Math.round(styleObj.font.sz * 1.33)}px` : isMobile ? '11px' : '13px';
                        const textAlign = styleObj?.alignment?.horizontal ?? (isNumericValue(val) ? 'right' : 'left');
                        const whiteSpace = styleObj?.alignment?.wrapText ? 'normal' : 'nowrap';
                        // Header strip cells — animated blue sheen (screen zinda rahe)
                        const isHdrCell = bgColor === PREMIUM.headerGrad;

                        // Soft tile borders — position EXACT same (Boss rule);
                        // rounded corners + spacing = Excel-cell feel gayab, app tiles feel
                        const isSectionEdge = c === 3 || c === 12 || c === 16;
                        const tileBorder = isHdrCell ? '1px solid rgba(255,255,255,0.35)' : `1px solid ${GRID_BORDER}`;
                        const borderTop = tileBorder;
                        const borderBottom = tileBorder;
                        const borderLeft = isSectionEdge && !isHdrCell ? `2px solid ${SECTION_EDGE}` : tileBorder;
                        const borderRight = tileBorder;

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
                              borderRadius: TILE_RADIUS,
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
                                    <option key={opt} value={opt} className="bg-white text-slate-800">{opt}</option>
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
                                  style={{ fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', fontStyle: 'inherit', color: 'inherit', backgroundColor: 'transparent', caretColor: '#059669', textAlign: textAlign as any }}
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

