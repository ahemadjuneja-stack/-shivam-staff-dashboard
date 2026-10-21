import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
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
  Edit3,
  Save,
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
  VerificationResult
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

    // If already in cache, no need to fetch
    if (sheetsCache[activeSheetName]) return;

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
            [activeSheetName]: {
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

  // Active sheet data
  const currentSheet = useMemo(() => {
    return sheetsCache[activeSheetName] || null;
  }, [sheetsCache, activeSheetName]);

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
      const wb = XLSX.read(buffer, { type: 'array' });

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
        const rawAoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          raw: true,
          defval: null
        });

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
        const merges: string[] = (ws['!merges'] || []).map((m) => XLSX.utils.encode_range(m));

        // 6. Extract column widths
        const cols: (number | null)[] = (ws['!cols'] || []).map((c) =>
          c?.wch ? c.wch : c?.wpx ? Math.round(c.wpx / 7) : null
        );

        parsedSheets[name] = {
          name,
          grid: finalGrid,
          merges,
          cols
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
          return;
        }
      }

      setUploadProgress(`Saving ${totalSheets} sheets to Firestore...`);

      const uid = auth.currentUser?.uid || 'admin';
      await saveMonthWorkbookToFirestore(
        db,
        monthId,
        monthLabel,
        uid,
        wb.SheetNames,
        parsedSheets,
        (saved, total) => {
          setUploadProgress(`Saving sheet ${saved}/${total}...`);
        }
      );

      setVerificationReport(report);
      showToast(`✓ ${monthLabel} upload safal raha!`, 'success');
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
      value: String(currentVal ?? '')
    });
  };

  const handleSaveCell = async () => {
    if (!editingCell || !currentSheet || !selectedMonthId) return;

    setSavingCell(true);
    const { row, col, value } = editingCell;

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
      // Update local state
      setSheetsCache((prev) => ({
        ...prev,
        [activeSheetName]: updatedSheet
      }));
      setEditingCell(null);
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
      const allSheets: { [sheetName: string]: SheetData } = { ...sheetsCache };

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

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl px-5 py-3.5 shadow-2xl backdrop-blur-md text-xs font-bold transition-all border ${
            toast.type === 'success'
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : toast.type === 'error'
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
              : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
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
          <button onClick={() => setToast(null)} className="ml-2 text-slate-400 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Top Bar: Month Selector + Upload + Download */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white tracking-wide">HISAB XL — DAILY EXCEL ACCOUNTS</h2>
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
              className="rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow focus:border-indigo-500 focus:outline-none disabled:opacity-50"
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
            className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loadingMonths ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleStartUpload}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>⬆ XL Upload Karein</span>
          </button>

          <button
            onClick={handleDownloadWorkbook}
            disabled={!currentMonth || !selectedMonthId}
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-200 shadow hover:bg-slate-800 hover:text-white transition disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5 text-emerald-400" />
            <span>⬇ XL Download</span>
          </button>
        </div>
      </div>

      {/* Hisab Check Verification Report Card */}
      {verificationReport && (
        <div
          className={`relative rounded-2xl p-4 shadow-lg border transition-all ${
            verificationReport.mismatches.length === 0
              ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-200'
              : 'border-amber-500/30 bg-amber-950/40 text-amber-200'
          }`}
        >
          {/* Dismiss button */}
          <button
            onClick={() => setVerificationReport(null)}
            title="Close Report"
            className="absolute top-3 right-3 rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>

          {verificationReport.mismatches.length === 0 ? (
            <div className="flex items-start gap-2.5 pr-8">
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-emerald-300">
                  ✅ Hisab Check: {verificationReport.daySheetCount} sheets me calculation bilkul Excel jaisa hai ({verificationReport.totalChecked} cells milaan kiye)
                </p>
                <p className="text-xs text-emerald-400/80 mt-1">
                  App auto-calculation engine matches stored Excel numbers 100%.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2 pr-8">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-amber-300">
                    ⚠️ Hisab Check: {verificationReport.mismatches.length} cells me app aur Excel ke numbers alag hain
                  </p>
                  <p className="text-xs text-amber-400/80 mt-0.5">
                    (Showing up to 20 differences below. Full list logged to browser console)
                  </p>
                </div>
              </div>

              <div className="mt-2 rounded-xl border border-amber-500/20 bg-slate-950/60 p-3 text-xs font-mono max-h-48 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-amber-900/50">
                {verificationReport.mismatches.slice(0, 20).map((m, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-4 py-0.5 border-b border-amber-900/20 last:border-0 text-slate-300">
                    <span>
                      Sheet <strong className="text-amber-400">'{m.sheetName}'</strong> → <span className="text-sky-300 font-bold">{m.cell}</span>
                    </span>
                    <span>
                      Excel <span className="text-emerald-400">{m.excelValue}</span>, App <span className="text-rose-400">{m.appValue}</span>
                    </span>
                  </div>
                ))}
                {verificationReport.mismatches.length > 20 && (
                  <p className="text-[11px] text-amber-400/70 italic pt-1">
                    ... and {verificationReport.mismatches.length - 20} more mismatches (see console)
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live Formula Total Chips (4 colored chips above the table) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* 1. Cash 1no (AH53) */}
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-3.5 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Cash 1no</p>
          <p className="text-xl font-extrabold text-white mt-0.5 font-mono">
            ₹{liveChips.cash1no.toLocaleString('en-IN')}
          </p>
          <p className="text-[10px] text-emerald-400/70 mt-1">Formula: AH53 = SUM(AH2:AH50)</p>
        </div>

        {/* 2. Recipt 1no (AI53) */}
        <div className="rounded-2xl border border-sky-500/20 bg-sky-950/20 p-3.5 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-sky-400">Recipt 1no</p>
          <p className="text-xl font-extrabold text-white mt-0.5 font-mono">
            ₹{liveChips.recipt1no.toLocaleString('en-IN')}
          </p>
          <p className="text-[10px] text-sky-400/70 mt-1">Formula: AI53 = SUM(AI2:AI50)</p>
        </div>

        {/* 3. Csah 2no (AJ53) */}
        <div className="rounded-2xl border border-amber-500/20 bg-amber-950/20 p-3.5 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Csah 2no</p>
          <p className="text-xl font-extrabold text-white mt-0.5 font-mono">
            ₹{liveChips.csah2no.toLocaleString('en-IN')}
          </p>
          <p className="text-[10px] text-amber-400/70 mt-1">Formula: AJ53 = SUM(AJ2:AJ50)</p>
        </div>

        {/* 4. Recipt 2no (AK53) */}
        <div className="rounded-2xl border border-purple-500/20 bg-purple-950/20 p-3.5 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-purple-400">Recipt 2no</p>
          <p className="text-xl font-extrabold text-white mt-0.5 font-mono">
            ₹{liveChips.recipt2no.toLocaleString('en-IN')}
          </p>
          <p className="text-[10px] text-purple-400/70 mt-1">Formula: AK53 = SUM(AK2:AK50)</p>
        </div>
      </div>

      {/* Day Tabs Bar (Numeric sheets 1..31 + non-numeric sheets like Reminder) */}
      {sortedSheetNames.length > 0 ? (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-800">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 shrink-0 mr-1.5 flex items-center gap-1">
            <Layers className="h-3.5 w-3.5 text-indigo-400" />
            Sheets:
          </span>
          {sortedSheetNames.map((name) => {
            const isSelected = activeSheetName === name;
            const isNumeric = !isNaN(Number(name));
            return (
              <button
                key={name}
                onClick={() => setActiveSheetName(name)}
                className={`shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-bold transition shadow-sm ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-indigo-600/30'
                    : 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {isNumeric ? `Day ${name}` : name}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center text-xs text-slate-400">
          Koi mahina ya sheets uplabdh nahi hain. Upar diye gaye button se Excel file upload karein.
        </div>
      )}

      {/* Excel Sheet Table View */}
      {loadingSheet ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-12 text-center text-slate-400">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"></div>
          <p className="text-xs font-semibold">Loading sheet "{activeSheetName}"...</p>
        </div>
      ) : liveGrid.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-12 text-center text-slate-500 text-xs">
          Sheet data load nahi ho saka ya khali hai.
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col">
          {/* Table Header Bar */}
          <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white">Sheet: {activeSheetName}</span>
              <span className="text-[10px] text-slate-400">
                (53 rows × {visibleColCount} visible cols | Col AD..AK helper columns hidden)
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-sky-950 border border-sky-700"></span>
                <span>Auto-computed (Read-only)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-slate-950 border border-slate-700"></span>
                <span>Editable (Tap to edit)</span>
              </span>
            </div>
          </div>

          {/* Excel Grid with Sticky Headers and Horizontal/Vertical Scroll */}
          <div className="overflow-auto max-h-[620px] scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
            <table
              className="w-max border-collapse text-[12px] select-text"
              style={{ minWidth: '100%' }}
            >
              {/* Sticky Column Headers: Row 0 / Column Letters A..AC */}
              <thead className="sticky top-0 z-20 bg-slate-950 shadow">
                <tr>
                  {/* Row Number Header Cell */}
                  <th className="sticky left-0 z-30 bg-slate-950 border border-slate-700 px-2.5 py-1 text-center font-mono text-[10px] text-slate-400 w-12 shrink-0">
                    #
                  </th>
                  {Array.from({ length: visibleColCount }).map((_, c) => {
                    const wch = currentSheet?.cols?.[c];
                    const widthPx = wch ? Math.max(Math.round(wch * 7), 55) : 75;
                    return (
                      <th
                        key={c}
                        style={{ width: `${widthPx}px`, minWidth: `${widthPx}px` }}
                        className="border border-slate-700 bg-slate-950 px-2 py-1.5 text-center font-mono text-[11px] font-bold text-slate-300 uppercase tracking-wider"
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
                  <tr key={r} className="hover:bg-slate-800/30 transition-colors">
                    {/* Row Index Sticky Column (1-based) */}
                    <td className="sticky left-0 z-10 bg-slate-950/95 border border-slate-700 px-2 py-1 text-center font-mono text-[10px] text-slate-500 font-bold shrink-0">
                      {r + 1}
                    </td>

                    {/* Columns A..AC (c=0..28) */}
                    {row.slice(0, visibleColCount).map((val, c) => {
                      const mergeKey = `${r},${c}`;
                      const mergeInfo = mergeMap.get(mergeKey);

                      // If cell is covered by another merged cell, skip rendering
                      if (mergeInfo?.isCovered) {
                        return null;
                      }

                      // Check if computed cell
                      const computed = isComputedCell(r, c);
                      const isNum = isNumericValue(val);

                      // Format value for display
                      let displayVal = val;
                      if (val === null || val === undefined) {
                        displayVal = '';
                      } else if (typeof val === 'number') {
                        // Display clean numbers
                        displayVal = Number.isInteger(val) ? val.toLocaleString('en-IN') : val.toFixed(2);
                      }

                      // Cap colSpan to visible columns
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
                          className={`border border-slate-700 px-2 py-1 text-[12px] transition-colors cursor-pointer select-text truncate ${
                            computed
                              ? 'bg-sky-950/30 text-sky-200 font-semibold border-sky-800/50'
                              : 'text-slate-200 hover:bg-indigo-600/10'
                          } ${isNum ? 'text-right font-mono' : 'text-left'}`}
                          style={{ maxWidth: '280px' }}
                        >
                          {String(displayVal)}
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

      {/* Cell Inline / Popover Editor Modal */}
      {editingCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">
                  Edit Cell: <span className="font-mono text-indigo-400">{cellToA1(editingCell.row, editingCell.col)}</span>
                </h3>
              </div>
              <button
                onClick={() => setEditingCell(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-xs text-slate-400">
              Row {editingCell.row + 1}, Column {colToLetter(editingCell.col)}
            </div>

            {/* Special Dropdown for Column F (c=5): Cash / Receipt */}
            {editingCell.col === 5 ? (
              <div>
                <label className="text-xs font-semibold text-slate-300">Payment Type (Col F)</label>
                <select
                  value={editingCell.value}
                  onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-bold text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">(Blank)</option>
                  <option value="Cash">Cash</option>
                  <option value="Receipt">Receipt</option>
                </select>
              </div>
            ) : editingCell.col === 4 || editingCell.col === 12 ? (
              /* Special Dropdown for Column E (c=4) or Column M (c=12): 1 / 2 */
              <div>
                <label className="text-xs font-semibold text-slate-300">
                  Number Category (Col {colToLetter(editingCell.col)})
                </label>
                <select
                  value={editingCell.value}
                  onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-bold text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">(Blank)</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
              </div>
            ) : editingCell.col === 16 ? (
              /* Special Dropdown for Column Q (c=16): Transport / Courior / In Hand / Other Party / Riksha */
              <div>
                <label className="text-xs font-semibold text-slate-300">Delivery / Mode (Col Q)</label>
                <select
                  value={editingCell.value}
                  onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-bold text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">(Blank)</option>
                  <option value="Transport">Transport</option>
                  <option value="Courior">Courior</option>
                  <option value="In Hand">In Hand</option>
                  <option value="Other Party">Other Party</option>
                  <option value="Riksha">Riksha</option>
                </select>
              </div>
            ) : (
              /* Standard Input */
              <div>
                <label className="text-xs font-semibold text-slate-300">Cell Value</label>
                <input
                  type="text"
                  autoFocus
                  value={editingCell.value}
                  onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveCell();
                    if (e.key === 'Escape') setEditingCell(null);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditingCell(null)}
                disabled={savingCell}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCell}
                disabled={savingCell}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-emerald-500 transition disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{savingCell ? 'Saving...' : 'Save Cell'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal ("⬆ XL Upload Karein") */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Upload Hisab Excel File</h3>
              </div>
              <button
                onClick={() => !uploading && setShowUploadModal(false)}
                disabled={uploading}
                className="text-slate-400 hover:text-white disabled:opacity-50"
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
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-bold text-white focus:border-indigo-500 focus:outline-none"
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
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
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
                  <p className="mt-1 text-[11px] text-emerald-400 font-medium">
                    ✓ Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              {/* Upload Progress Status */}
              {uploading && (
                <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs font-semibold text-indigo-300 flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent shrink-0"></div>
                  <span>{uploadProgress || 'Uploading and parsing sheets...'}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                disabled={uploading}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={processAndUploadFile}
                disabled={uploading || !selectedFile}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition disabled:opacity-50"
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
