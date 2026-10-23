import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx-js-style';
import { collection, getDocs, doc, getDoc, query, orderBy } from 'firebase/firestore';
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
  Layers,
  Calculator,
  ChevronRight,
  CheckCircle2,
  AlertTriangle
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
  saveSheetToFirestore,
  loadSheetFromFirestore,
  saveMonthWorkbookToFirestore,
  exportMonthWorkbook,
  CellValue,
  verifySheet,
  MismatchItem,
  VerificationResult,
  colorToCss,
  extractStyles,
  CANON_TABLE,
  CANON_INDEX,
  CANON_COL_WIDTHS_PX
} from './hisabXL';

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

  // Editing cell state
  const [editingCell, setEditingCell] = useState<EditingCellState | null>(null);
  const [savingCell, setSavingCell] = useState<boolean>(false);

  // Toast feedback
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // 1. Fetch available uploaded months from Firestore
  const fetchMonths = async (selectLatest = false, targetId?: string) => {
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

      // Sort descending by monthId
      list.sort((a, b) => b.monthId.localeCompare(a.monthId));
      setMonths(list);

      if (list.length > 0) {
        if (targetId && list.some((m) => m.monthId === targetId)) {
          setSelectedMonthId(targetId);
        } else if (selectLatest || !selectedMonthId || !list.some((m) => m.monthId === selectedMonthId)) {
          setSelectedMonthId(list[0].monthId);
        }
      } else {
        setSelectedMonthId('');
      }
    } catch (err: unknown) {
      console.error('Failed to fetch hisab months:', err);
      const msg = (err as Error)?.message || '';
      if (msg.includes('permission') || msg.includes('Permission')) {
        showToast('Permission denied — Firebase Console me hisab rules publish karo', 'error');
      } else {
        showToast('Failed to load Hisab months', 'error');
      }
    } finally {
      setLoadingMonths(false);
    }
  };

  useEffect(() => {
    fetchMonths(true);
  }, []);

  // Current active month object
  const currentMonth = useMemo(() => {
    return months.find((m) => m.monthId === selectedMonthId) || null;
  }, [months, selectedMonthId]);

  // Sorted sheet names for the current month
  const sortedSheetNames = useMemo(() => {
    if (!currentMonth || !currentMonth.sheetNames) return [];
    return sortSheetNames(currentMonth.sheetNames);
  }, [currentMonth]);

  // Set active sheet when month changes
  useEffect(() => {
    if (sortedSheetNames.length > 0) {
      if (!activeSheetName || !sortedSheetNames.includes(activeSheetName)) {
        setActiveSheetName(sortedSheetNames[0]);
      }
    } else {
      setActiveSheetName('');
    }
  }, [selectedMonthId, sortedSheetNames]);

  // 2. Fetch active sheet from Firestore if not cached
  useEffect(() => {
    if (!selectedMonthId || !activeSheetName) return;

    // Cache key is MONTH-SCOPED: same sheet name in different months must never collide
    const cacheKey = `${selectedMonthId}::${activeSheetName}`;
    if (sheetsCache[cacheKey]) return;

    let isMounted = true;
    setLoadingSheet(true);

    loadSheetFromFirestore(db, selectedMonthId, activeSheetName)
      .then((sheetData) => {
        if (!isMounted) return;
        if (sheetData) {
          // Run formula engine on day sheets
          const isNumericSheet = !isNaN(Number(activeSheetName));
          const processed = isNumericSheet ? runFormulaEngine(sheetData.grid).grid : sheetData.grid;
          setSheetsCache((prev) => ({
            ...prev,
            [cacheKey]: {
              ...sheetData,
              grid: processed
            }
          }));
        } else {
          showToast(`Sheet "${activeSheetName}" doc not found`, 'error');
        }
      })
      .catch((err) => {
        console.error('Error loading sheet:', err);
        const msg = (err as Error)?.message || '';
        if (msg.includes('permission')) {
          showToast('Permission denied — Firebase Console me hisab rules publish karo', 'error');
        } else {
          showToast(`Error loading sheet: ${msg}`, 'error');
        }
      })
      .finally(() => {
        if (isMounted) setLoadingSheet(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedMonthId, activeSheetName, sheetsCache]);

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
    const isNumericSheet = !isNaN(Number(activeSheetName));
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

  // 3. Handle File Upload & Processing
  const handleStartUpload = () => {
    setSelectedFile(null);
    setShowUploadModal(true);
    setUploadProgress('');
  };

  const processAndUploadFile = async () => {
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
        const isDay = !isNaN(Number(name)) && name.trim() !== '';
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

      // Overwrite check
      const existing = months.find((m) => m.monthId === monthId);
      if (existing) {
        const confirmOverwrite = window.confirm(
          `Ye mahina (${monthLabel}) pehle se uploaded hai. Overwrite karein?`
        );
        if (!confirmOverwrite) {
          setVerificationReport(report);
          setShowUploadModal(false);
          showToast('Upload CANCELLED — kuch bhi save nahi hua, purana data waise ka waisa hai', 'info');
          return;
        }
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
    const isNumericSheet = !isNaN(Number(activeSheetName));
    const processedGrid = isNumericSheet ? runFormulaEngine(updatedGrid).grid : updatedGrid;

    const updatedSheet: SheetData = {
      ...currentSheet,
      grid: processedGrid
    };

    try {
      await saveSheetToFirestore(db, selectedMonthId, updatedSheet);
      // Update local state (month-scoped cache key)
      setSheetsCache((prev) => ({
        ...prev,
        [`${selectedMonthId}::${activeSheetName}`]: updatedSheet
      }));
      setEditingCell((prev) => (prev && prev.row === row && prev.col === col ? null : prev));
      showToast('✓ Save ho gaya', 'success');
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

  // 5. Handle Full Workbook Download
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

      // Ensure all sheets are loaded
      for (const name of currentMonth.sheetNames) {
        if (!allSheets[name]) {
          const loaded = await loadSheetFromFirestore(db, selectedMonthId, name);
          if (loaded) {
            allSheets[name] = loaded;
          }
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
  const isDaySheet = !isNaN(Number(activeSheetName)) && activeSheetName.trim() !== '';
  const monthShort = MONTH_NAMES[Number(String(selectedMonthId).split('-')[1] || 1) - 1]?.slice(0, 3) || '';

  return (
    <div className="hisab-fullbleed flex min-h-screen flex-col gap-2 bg-white text-black">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl px-5 py-3.5 shadow-2xl backdrop-blur-md text-xs font-bold transition-all border ${
            toast.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : toast.type === 'error'
              ? 'bg-rose-50 text-rose-800 border-rose-300'
              : 'bg-indigo-50 text-indigo-800 border-indigo-300'
          }`}
        >
          {toast.type === 'success' ? (
            <Check className="h-4 w-4 text-emerald-600" />
          ) : toast.type === 'error' ? (
            <AlertCircle className="h-4 w-4 text-rose-600" />
          ) : (
            <Calculator className="h-4 w-4 text-indigo-600" />
          )}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-400 hover:text-slate-700">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Top Bar: Month Selector + Upload + Download (Slim Sticky Ribbon) */}
      <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-gray-300 bg-white px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-800 tracking-wide">HISAB XL — DAILY EXCEL ACCOUNTS</h2>
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
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            >
              {months.length === 0 ? (
                <option value="">(No uploaded months yet)</option>
              ) : (
                months.map((m) => (
                  <option key={m.monthId} value={m.monthId}>
                    📅 {m.label} ({m.sheetNames?.length || 0} sheets)
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            onClick={() => fetchMonths(false, selectedMonthId)}
            title="Refresh Months"
            disabled={loadingMonths}
            className="rounded border border-slate-200 bg-slate-50 p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingMonths ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleStartUpload}
            className="flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>⬆ XL Upload Karein</span>
          </button>

          <button
            onClick={handleDownloadWorkbook}
            disabled={!currentMonth || !selectedMonthId}
            className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5 text-emerald-600" />
            <span>⬇ XL Download</span>
          </button>
        </div>
      </div>

      {/* Hisab Check Verification Report Banner */}
      {verificationReport && (
        <div
          className={`relative rounded-none border-y border-x-0 px-3 py-2 text-xs transition-all ${
            verificationReport.mismatches.length === 0
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {/* Dismiss button */}
          <button
            onClick={() => setVerificationReport(null)}
            title="Close Report"
            className="absolute top-2 right-3 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-800 transition"
          >
            <X className="h-4 w-4" />
          </button>

          {verificationReport.mismatches.length === 0 ? (
            <div className="flex items-start gap-2.5 pr-8">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-emerald-900">
                  ✅ Hisab Check: {verificationReport.daySheetCount} sheets me calculation bilkul Excel jaisa hai ({verificationReport.totalChecked} cells milaan kiye)
                </p>
                <p className="text-[11px] text-emerald-700 mt-0.5">
                  App auto-calculation engine matches stored Excel numbers 100%.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 pr-8">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-amber-900">
                    ⚠️ Hisab Check: {verificationReport.mismatches.length} cells me app aur Excel ke numbers alag hain
                  </p>
                  <p className="text-[11px] text-amber-700">
                    (Showing up to 20 differences below. Full list logged to browser console)
                  </p>
                </div>
              </div>

              <div className="mt-1 rounded border border-amber-200 bg-white p-2 font-mono max-h-40 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-amber-300 shadow-inner">
                {verificationReport.mismatches.slice(0, 20).map((m, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-4 py-0.5 border-b border-amber-100 last:border-0 text-slate-700 text-[11px]">
                    <span>
                      Sheet <strong className="text-amber-800">'{m.sheetName}'</strong> → <span className="text-sky-700 font-bold">{m.cell}</span>
                    </span>
                    <span>
                      Excel <span className="text-emerald-700 font-bold">{m.excelValue}</span>, App <span className="text-rose-600 font-bold">{m.appValue}</span>
                    </span>
                  </div>
                ))}
                {verificationReport.mismatches.length > 20 && (
                  <p className="text-[10px] text-amber-700 italic pt-0.5">
                    ... and {verificationReport.mismatches.length - 20} more mismatches (see console)
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Save Failures Persistent Banner */}
      {saveFailures.length > 0 && (
        <div className="flex items-start justify-between gap-3 border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          <div>
            <p className="font-bold">
              ⚠️ {saveFailures.length} sheets Firestore me save NAHI hui: {saveFailures.slice(0, 12).join(', ')}
              {saveFailures.length > 12 ? ` +${saveFailures.length - 12} more` : ''}
            </p>
            <p className="text-[11px] text-rose-700 mt-0.5">
              Ye sheets purana data dikha rahi hongi. Internet check karo aur file dobara upload karo. Baar-baar fail ho to F12 console me [HISAB SAVE FAIL] error dekho.
            </p>
          </div>
          <button onClick={() => setSaveFailures([])} className="rounded p-1 text-rose-400 hover:bg-rose-100" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Live Formula Total Strip (Slim inline strip) */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-gray-200 bg-gray-50 px-3 py-1.5">
        {/* 1. Cash 1no (AH53) */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600 shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Cash 1no:</span>
          <span className="font-mono font-bold text-gray-900">₹{liveChips.cash1no.toLocaleString('en-IN')}</span>
          <span className="text-[10px] text-gray-500 font-medium">(AH53 = SUM(AH2:AH50))</span>
        </div>

        {/* 2. Recipt 1no (AI53) */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-600 shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Recipt 1no:</span>
          <span className="font-mono font-bold text-gray-900">₹{liveChips.recipt1no.toLocaleString('en-IN')}</span>
          <span className="text-[10px] text-gray-500 font-medium">(AI53 = SUM(AI2:AI50))</span>
        </div>

        {/* 3. Csah 2no (AJ53) */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Csah 2no:</span>
          <span className="font-mono font-bold text-gray-900">₹{liveChips.csah2no.toLocaleString('en-IN')}</span>
          <span className="text-[10px] text-gray-500 font-medium">(AJ53 = SUM(AJ2:AJ50))</span>
        </div>

        {/* 4. Recipt 2no (AK53) */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="h-2.5 w-2.5 rounded-full bg-purple-600 shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Recipt 2no:</span>
          <span className="font-mono font-bold text-gray-900">₹{liveChips.recipt2no.toLocaleString('en-IN')}</span>
          <span className="text-[10px] text-gray-500 font-medium">(AK53 = SUM(AK2:AK50))</span>
        </div>
      </div>

      {/* Day Tabs Bar (Excel sheet tabs look) */}
      {sortedSheetNames.length > 0 ? (
        <div className="flex items-stretch gap-0 overflow-x-auto border-b border-gray-300 bg-gray-100 px-1">
          {sortedSheetNames.map((name) => {
            const isSelected = activeSheetName === name;
            return (
              <button
                key={name}
                onClick={() => setActiveSheetName(name)}
                className={`shrink-0 whitespace-nowrap border-r border-gray-200 px-3.5 py-1.5 text-xs font-semibold transition ${
                  isSelected
                    ? 'bg-white font-bold text-emerald-700 shadow-[inset_0_2px_0_0_rgb(5_150_105)]'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="bg-gray-50 p-6 text-center text-xs text-gray-500">
          Koi mahina ya sheets uplabdh nahi hain. Upar diye gaye button se Excel file upload karein.
        </div>
      )}

      {/* Excel Sheet Table View */}
      {loadingSheet ? (
        <div className="bg-gray-50 p-10 text-center text-xs text-gray-500">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"></div>
          <p className="font-semibold">Loading sheet "{activeSheetName}"...</p>
        </div>
      ) : liveGrid.length === 0 ? (
        <div className="bg-gray-50 p-10 text-center text-xs text-gray-500">
          Sheet data load nahi ho saka ya khali hai.
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden bg-white">
          {/* Excel Grid with Sticky Headers and Horizontal/Vertical Scroll */}
          <div className="flex-1 overflow-auto bg-white" style={{ maxHeight: 'calc(100vh - 150px)' }}>
            <table
              className="w-max border-collapse select-text bg-white"
              style={{ minWidth: '100%', fontFamily: "'Comfortaa', 'Segoe UI', sans-serif" }}
            >
              {/* Sticky Column Headers: Row 0 / Column Letters A..AC */}
              <thead className="sticky top-0 z-20 bg-gray-100 shadow-sm">
                <tr>
                  {/* Row Number Header Cell */}
                  <th className="sticky left-0 z-30 border border-gray-300 bg-gray-100 px-1 py-0.5 text-center font-mono text-[10px] font-bold text-gray-700 w-12 shrink-0"></th>
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

              {/* Table Body (53 rows) */}
              <tbody>
                {liveGrid.map((row, r) => (
                  <tr key={r} className="hover:opacity-95 transition-opacity" style={{ height: r === 0 ? 47 : 26 }}>
                    {/* Row Index Sticky Column (1-based) */}
                    <td className="sticky left-0 z-10 border border-gray-300 bg-gray-100 px-1 py-0.5 text-center font-mono text-[10px] font-semibold text-gray-600 shrink-0">
                      {r + 1}
                    </td>

                    {/* Columns A..AC (c=0..28) */}
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

                      let displayVal = val;
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
                                className="w-full border-0 outline-none bg-transparent p-0 m-0 cursor-pointer"
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
                                className="w-full border-0 outline-none bg-transparent p-0 m-0"
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
      )}

      {/* Upload Modal ("⬆ XL Upload Karein") */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-800">Upload Hisab Excel File</h3>
              </div>
              <button
                onClick={() => !uploading && setShowUploadModal(false)}
                disabled={uploading}
                className="text-slate-400 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Month Selection */}
              <div>
                <label className="font-semibold text-slate-700">Select Month</label>
                <select
                  value={uploadMonthNum}
                  onChange={(e) => setUploadMonthNum(Number(e.target.value))}
                  disabled={uploading}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-800 focus:border-indigo-500 focus:outline-none"
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
                <label className="font-semibold text-slate-700">Select Year</label>
                <input
                  type="number"
                  value={uploadYear}
                  onChange={(e) => setUploadYear(Number(e.target.value))}
                  disabled={uploading}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* File Input */}
              <div>
                <label className="font-semibold text-slate-700">Excel File (.xlsx, .xls)</label>
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
                  className="mt-1.5 w-full text-xs text-slate-500 file:mr-3 file:rounded-xl file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-xs file:font-bold file:text-white hover:file:bg-indigo-700"
                />
                {selectedFile && (
                  <p className="mt-1 text-[11px] text-emerald-600 font-medium">
                    ✓ Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              {/* Upload Progress Status */}
              {uploading && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs font-semibold text-indigo-800 flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent shrink-0"></div>
                  <span>{uploadProgress || 'Uploading and parsing sheets...'}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                disabled={uploading}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={processAndUploadFile}
                disabled={uploading || !selectedFile}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-700 transition disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{uploading ? 'Processing...' : 'Upload & Process'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
