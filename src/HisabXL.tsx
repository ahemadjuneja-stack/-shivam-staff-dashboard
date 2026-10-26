import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx-js-style';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  Upload,
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
  normalizeGrid,
  extractStyles,
  loadSheetFromFirestore,
  saveMonthWorkbookToFirestore,
  exportMonthWorkbook,
  CellValue,
  verifySheet,
  MismatchItem,
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

export interface HisabCheckReport {
  daySheetCount: number;
  totalChecked: number;
  mismatches: MismatchItem[];
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

  // Upload modal & verification report state
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadMonthNum, setUploadMonthNum] = useState<number>(new Date().getMonth() + 1); // 1-12
  const [uploadYear, setUploadYear] = useState<number>(new Date().getFullYear());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [verificationReport, setVerificationReport] = useState<HisabCheckReport | null>(null);
  const [saveFailures, setSaveFailures] = useState<string[]>([]);
  const [overwritePrompt, setOverwritePrompt] = useState<{ monthId: string; monthLabel: string } | null>(null);

  // Editing cell state
  const [editingCell, setEditingCell] = useState<EditingCellState | null>(null);
  const [savingCell, setSavingCell] = useState<boolean>(false);

  // Toast feedback
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // 3. Handle File Upload & Processing (purane mahine import karne ke liye)
  const handleStartUpload = () => {
    setSelectedFile(null);
    setShowUploadModal(true);
    setUploadProgress('');
  };

  const processAndUploadFile = async (forceOverwrite = false) => {
    if (!selectedFile) {
      showToast('Kripya Excel file select karein (.xlsx ya .xls)', 'error');
      return;
    }

    const monthPadded = String(uploadMonthNum).padStart(2, '0');
    const monthId = `${uploadYear}-${monthPadded}`;
    const monthLabel = `${MONTH_NAMES[uploadMonthNum - 1]}-${uploadYear}`;

    setUploading(true);
    setUploadProgress('Reading Excel file...');

    try {
      const buffer = await selectedFile.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellStyles: true });

      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        throw new Error('Excel file me koi sheet nahi mili.');
      }

      const totalSheets = wb.SheetNames.length;
      const parsedSheets: { [sheetName: string]: SheetData } = {};

      setUploadProgress(`Processing ${totalSheets} sheets...`);

      let daySheetCount = 0;
      let totalChecked = 0;
      const allMismatches: { sheetName: string; cell: string; excelValue: number; appValue: number }[] = [];

      for (let i = 0; i < totalSheets; i++) {
        const name = wb.SheetNames[i];
        const ws = wb.Sheets[name];

        // 1. Convert to 2D array of values
        const rawAoa = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          raw: true,
          defval: null
        }) as unknown[][];

        // 2. Normalize to at least 53 rows × 37 columns
        const normalized = normalizeGrid(rawAoa, 53, 37);

        // 3. Verify accounting formulas vs stored values for day sheets
        const isDay = isDaySheetName(name);
        if (isDay) {
          daySheetCount++;
          const checkRes = verifySheet(rawAoa as CellValue[][], name);
          totalChecked += checkRes.checked;
          for (const m of checkRes.mismatches) {
            allMismatches.push({
              sheetName: name,
              cell: m.cell,
              excelValue: m.excelValue,
              appValue: m.appValue
            });
          }
        }

        // 4. Run formula engine for day sheets
        const finalGrid = isDay ? runFormulaEngine(normalized).grid : normalized;

        // 5. Extract merges
        const merges: string[] = (ws['!merges'] || []).map((m: any) => XLSX.utils.encode_range(m));

        // 6. Extract column widths
        const cols: (number | null)[] = (ws['!cols'] || []).map((c: any) =>
          c?.wch ? c.wch : c?.wpx ? Math.round(c.wpx / 7) : null
        );

        // 7. Cell styles: day sheets = CANONICAL template DNA (same-to-same PC look, upload file se independent);
        //    non-day sheets (Reminder etc.) = file se extract
        let styleTable: Record<string, unknown>[];
        let styleIndex: (number | null)[][];
        if (isDay) {
          styleTable = CANON_TABLE as unknown as Record<string, unknown>[];
          styleIndex = CANON_INDEX;
        } else {
          const styleRows = Math.max(normalized.length, 53);
          const styleCols = Math.max(normalized[0]?.length || 0, 37);
          const extracted = extractStyles(ws, styleRows, styleCols);
          styleTable = extracted.styleTable;
          styleIndex = extracted.styleIndex;
        }

        parsedSheets[name] = {
          name,
          grid: finalGrid,
          merges,
          cols,
          styleTable,
          styleIndex
        };
      }

      const report: HisabCheckReport = {
        daySheetCount,
        totalChecked,
        mismatches: allMismatches
      };

      if (allMismatches.length > 0) {
        console.log('Hisab Check Full Mismatches:', allMismatches);
      }

      // Overwrite check — in-app modal (window.confirm sandboxed preview me block ho jata hai)
      const existing = months.find((m) => m.monthId === monthId);
      if (existing && !existing.synthetic && !forceOverwrite) {
        setOverwritePrompt({ monthId, monthLabel });
        return;
      }

      setUploadProgress(`Saving ${totalSheets} sheets to Firestore...`);

      const uid = auth.currentUser?.uid || 'admin';
      const saveRes = await saveMonthWorkbookToFirestore(
        db,
        monthId,
        monthLabel,
        uid,
        wb.SheetNames,
        parsedSheets,
        (savedCount, totalCount) => {
          setUploadProgress(`Saving sheet ${savedCount}/${totalCount}...`);
        }
      );

      // Mirror bhi update — uploaded sheets offline turant available
      for (const name of Object.keys(parsedSheets)) {
        mirrorSetSheet(monthId, name, {
          grid: parsedSheets[name].grid,
          merges: parsedSheets[name].merges,
          cols: parsedSheets[name].cols
        });
      }
      mirrorSetMonthDoc(monthId, { label: monthLabel, sheetNames: wb.SheetNames });

      setVerificationReport(report);
      if (saveRes.failed.length > 0) {
        setSaveFailures(saveRes.failed);
        showToast(`⚠️ ${saveRes.failed.length} sheets save NAHI hui — niche red banner dekho`, 'error');
      } else {
        setSaveFailures([]);
        showToast(`✓ ${monthLabel} upload safal — ${saveRes.saved.length}/${wb.SheetNames.length} sheets saved!`, 'success');
      }
      setShowUploadModal(false);
      setSheetsCache({});
      await fetchMonths(false, monthId);
      setActiveSheetName(wb.SheetNames[0]);
    } catch (err: unknown) {
      console.error('Upload error:', err);
      const msg = (err as Error)?.message || '';
      if (msg.includes('permission') || msg.includes('Permission')) {
        showToast('Permission denied — Firebase Console me hisab rules publish karo', 'error');
      } else {
        showToast(`Upload failed: ${msg}`, 'error');
      }
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

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
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border px-5 py-3.5 shadow-2xl backdrop-blur-md text-xs font-bold transition-all ${
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

      {/* Top Bar (navy ribbon): Month Selector + TODAY + Upload + Download */}
      <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-4 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
            <div className="leading-tight">
              <h2 className="text-base font-black tracking-wide text-white">HISAB XL</h2>
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-400/90">Daily Excel Accounts — Chart /10</p>
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
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
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
          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-[10px] font-black tracking-wider text-indigo-300">
            <Calendar className="h-3 w-3" />
            TODAY • {todayLabel}
          </span>

          <button
            onClick={() => fetchMonths(false, selectedMonthId)}
            title="Refresh Months"
            disabled={loadingMonths}
            className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 transition hover:bg-slate-700 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingMonths ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleStartUpload}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>XL Upload</span>
          </button>

          <button
            onClick={handleDownloadWorkbook}
            disabled={!currentMonth || !selectedMonthId}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            <span>XL Download</span>
          </button>
        </div>
      </div>

      {/* Offline-first banner (OFFLINE / SYNC PENDING) */}
      <div className="px-4 pt-3">
        <OutboxBanner />
      </div>

      {/* Hisab Check Verification Report Banner (dark) */}
      {verificationReport && (
        <div
          className={`mx-4 mt-3 rounded-xl border px-4 py-2.5 text-xs transition-all ${
            verificationReport.mismatches.length === 0
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          }`}
        >
          <button
            onClick={() => setVerificationReport(null)}
            title="Close Report"
            className="absolute right-6 top-6 rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>

          {verificationReport.mismatches.length === 0 ? (
            <div className="flex items-start gap-2.5 pr-8">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div>
                <p className="font-bold">
                  Hisab Check: {verificationReport.daySheetCount} sheets me calculation bilkul Excel jaisa hai ({verificationReport.totalChecked} cells milaan kiye)
                </p>
                <p className="mt-0.5 text-[11px] text-emerald-400/80">
                  App auto-calculation engine matches stored Excel numbers 100%.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 pr-8">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="font-bold">
                    Hisab Check: {verificationReport.mismatches.length} cells me app aur Excel ke numbers alag hain
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-400/80">
                    (Showing up to 20 differences below. Full list logged to browser console)
                  </p>
                </div>
              </div>

              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-amber-500/20 bg-slate-950 p-2 font-mono text-[11px]">
                {verificationReport.mismatches.slice(0, 20).map((m, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-4 border-b border-amber-500/10 py-0.5 text-slate-300 last:border-0">
                    <span>
                      Sheet <strong className="text-amber-300">'{m.sheetName}'</strong> → <span className="font-bold text-sky-300">{m.cell}</span>
                    </span>
                    <span>
                      Excel <span className="font-bold text-emerald-300">{m.excelValue}</span>, App <span className="font-bold text-rose-400">{m.appValue}</span>
                    </span>
                  </div>
                ))}
                {verificationReport.mismatches.length > 20 && (
                  <p className="pt-0.5 text-[10px] italic text-amber-400/80">
                    ... and {verificationReport.mismatches.length - 20} more mismatches (see console)
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Save Failures Persistent Banner (dark) */}
      {saveFailures.length > 0 && (
        <div className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
          <div>
            <p className="font-bold">
              {saveFailures.length} sheets Firestore me save NAHI hui: {saveFailures.slice(0, 12).join(', ')}
              {saveFailures.length > 12 ? ` +${saveFailures.length - 12} more` : ''}
            </p>
            <p className="mt-0.5 text-[11px] text-rose-400/80">
              Ye sheets purana data dikha rahi hongi. Internet check karo aur file dobara upload karo. Baar-baar fail ho to F12 console me [HISAB SAVE FAIL] error dekho.
            </p>
          </div>
          <button onClick={() => setSaveFailures([])} className="rounded p-1 text-rose-400 hover:bg-rose-500/10" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Live Formula Total Strip (navy cards) */}
      <div className="grid grid-cols-2 gap-2 px-4 pt-3 lg:grid-cols-4">
        {([
          { label: 'CASH 1NO', key: 'cash1no' as const, dot: 'bg-emerald-400', formula: 'AH53 = SUM(AH2:AH50)' },
          { label: 'RECEIPT 1NO', key: 'recipt1no' as const, dot: 'bg-sky-400', formula: 'AI53 = SUM(AI2:AI50)' },
          { label: 'CASH 2NO', key: 'csah2no' as const, dot: 'bg-amber-400', formula: 'AJ53 = SUM(AJ2:AJ50)' },
          { label: 'RECEIPT 2NO', key: 'recipt2no' as const, dot: 'bg-purple-400', formula: 'AK53 = SUM(AK2:AK50)' }
        ]).map((chip) => (
          <div key={chip.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/80 px-3.5 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${chip.dot}`} />
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{chip.label}</span>
              </div>
              <p className="mt-0.5 truncate text-[9px] font-medium text-slate-600">{chip.formula}</p>
            </div>
            <span className="font-mono text-base font-black text-white">
              ₹{liveChips[chip.key].toLocaleString('en-IN')}
            </span>
          </div>
        ))}
      </div>

      {/* Guide strip (Boss ke 3 rules — UI English) */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pt-2.5 text-[10.5px] font-semibold text-slate-500">
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
          <div className="flex items-stretch gap-0 overflow-x-auto rounded-t-xl border border-b-0 border-slate-800 bg-slate-900/90 px-1 pt-1">
            {sortedSheetNames.map((name) => {
              const isSelected = activeSheetName === name;
              const isTodayTab = selectedMonthId === realMonthId() && name === todayDayStr();
              return (
                <button
                  key={name}
                  onClick={() => setActiveSheetName(name)}
                  title={isTodayTab ? 'Aaj ka din — fresh 0 se start' : isDaySheetName(name) ? `Day ${name}` : 'Haste & Reminder'}
                  className={`shrink-0 whitespace-nowrap rounded-t-lg border-r border-slate-800 px-3.5 py-1.5 text-xs font-semibold transition ${
                    isSelected
                      ? 'bg-slate-950 font-bold text-emerald-400 shadow-[inset_0_2px_0_0_rgb(16_185_129)]'
                      : isTodayTab
                      ? 'text-indigo-300 hover:bg-slate-800/60'
                      : 'text-slate-400 hover:bg-slate-800/60'
                  }`}
                >
                  {name}
                  {isTodayTab && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-indigo-400 align-middle" />}
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
          <div className="flex flex-wrap items-center gap-x-3 rounded-lg border border-indigo-500/25 bg-indigo-500/10 px-3.5 py-2 text-[11px] font-bold text-indigo-300">
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
          <div className="overflow-hidden rounded-b-xl rounded-tr-xl border border-slate-800 bg-white shadow-2xl">
            <div className="overflow-auto bg-white" style={{ maxHeight: 'calc(100vh - 140px)' }}>
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

      {/* Upload Modal ("XL Upload" — purana mahina import) */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-5 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Upload Hisab Excel File</h3>
              </div>
              <button
                onClick={() => !uploading && setShowUploadModal(false)}
                disabled={uploading}
                className="text-slate-500 hover:text-slate-300 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Month Selection */}
              <div>
                <label className="font-semibold text-slate-300">Select Month</label>
                <select
                  value={uploadMonthNum}
                  onChange={(e) => setUploadMonthNum(Number(e.target.value))}
                  disabled={uploading}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs font-bold text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  {MONTH_NAMES.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Year Selection */}
              <div>
                <label className="font-semibold text-slate-300">Select Year</label>
                <input
                  type="number"
                  value={uploadYear}
                  onChange={(e) => setUploadYear(Number(e.target.value))}
                  disabled={uploading}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* File Input */}
              <div>
                <label className="font-semibold text-slate-300">Excel File (.xlsx, .xls)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls"
                  disabled={uploading}
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      setSelectedFile(files[0]);
                    }
                  }}
                  className="mt-1.5 w-full text-xs text-slate-400 file:mr-3 file:rounded-xl file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-xs file:font-bold file:text-white hover:file:bg-indigo-500"
                />
                {selectedFile && (
                  <p className="mt-1 text-[11px] font-medium text-emerald-400">
                    ✓ Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              {/* Upload Progress Status */}
              {uploading && (
                <div className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs font-semibold text-indigo-300">
                  <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent"></div>
                  <span>{uploadProgress || 'Uploading and parsing sheets...'}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                disabled={uploading}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => processAndUploadFile(false)}
                disabled={uploading || !selectedFile}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{uploading ? 'Processing...' : 'Upload & Process'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overwrite Confirm Modal (in-app — sandbox-safe) */}
      {overwritePrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-amber-500/40 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <h3 className="text-sm font-bold text-white">Mahina pehle se uploaded hai</h3>
            </div>
            <p className="text-xs text-slate-300">
              <strong>{overwritePrompt.monthLabel}</strong> pehle se uploaded hai. Overwrite karne par us mahine ka purana data REPLACE ho jayega. Aage badhein?
            </p>
            <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setOverwritePrompt(null)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setOverwritePrompt(null);
                  processAndUploadFile(true);
                }}
                className="rounded-xl bg-amber-600 px-5 py-2 text-xs font-bold text-white shadow transition hover:bg-amber-500"
              >
                Haan, Overwrite karein
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

