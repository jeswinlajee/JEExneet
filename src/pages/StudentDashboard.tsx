import React, { useState, useEffect } from 'react';
import { supabase, mapExamRow, mapSubmissionRow, mapUserRow, ExamRow, SubmissionRow, UserRow } from '../lib/supabase';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { useAuth } from '../context/AuthContext';
import { Exam, Submission, TimestampLike } from '../types';
import { calculateSubmissionScore } from '../lib/scoreUtils';
import { ChartBar as BarChart3, Calendar, Clock, ChevronRight, Globe, Settings, User as UserIcon, LogOut, Trophy, History, LayoutDashboard, BrainCircuit, Sparkles, ArrowUpRight, Loader as Loader2, X, CircleCheck as CheckCircle2, Activity, FileText, Trash2, TriangleAlert as AlertTriangle, Printer } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area, BarChart, Bar, Cell } from 'recharts';
import SettingsModal from '../components/SettingsModal';
import { ReviewButton } from '../components/ReviewButton';
import { authenticateGoogle, createSpreadsheet, populateSpreadsheet } from '../lib/googleSheets';
import { downloadLocalDoc, createGoogleDocInDrive } from '../lib/googleDocs';

// Helper to convert TimestampLike to Date
const toDate = (ts: TimestampLike | undefined | null): Date => {
  if (!ts) return new Date();
  return new Date(ts.seconds * 1000);
};

interface StudentDashboardProps {
  onStartTest: (examId: string) => void;
}

export default function StudentDashboard({ onStartTest }: StudentDashboardProps) {
  const { profile, logout } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [reviewExam, setReviewExam] = useState<{exam: Exam, sub: Submission} | null>(null);
  const [docExportState, setDocExportState] = useState<{ exam: Exam, studentName?: string, studentEmail?: string, submission?: Submission } | null>(null);
  const [isCreatingDocs, setIsCreatingDocs] = useState(false);
  const [createdDocUrl, setCreatedDocUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'hub' | 'exams' | 'compare' | 'integrity' | 'report'>('hub');
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const [allUsers, setAllUsers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [preparingExam, setPreparingExam] = useState<Exam | null>(null);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // New Detailed Report states
  const [selectedReportExam, setSelectedReportExam] = useState<Exam | null>(null);
  const [selectedReportSub, setSelectedReportSub] = useState<Submission | null>(null);
  const [verifiedGoogleUser, setVerifiedGoogleUser] = useState<{ email: string; displayName: string; photoURL: string | null } | null>(null);
  const [isVerifyingGmail, setIsVerifyingGmail] = useState(false);
  const [reportGenState, setReportGenState] = useState<{ status: 'idle' | 'preparing' | 'generating' | 'completed' | 'error'; message?: string; downloadUrl?: string; error?: string }>({
    status: 'idle'
  });

  const [exportState, setExportState] = useState<{ isLoading: boolean; url: string | null; error: string | null }>({
    isLoading: false,
    url: null,
    error: null
  });

  useEffect(() => {
    setExportState({ isLoading: false, url: null, error: null });
  }, [reviewExam]);

  const handleGmailVerification = async () => {
    setIsVerifyingGmail(true);
    setReportGenState({ status: 'idle' });
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
        }
      });

      if (error) throw error;

      // Get the session after OAuth
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      const providerToken = session?.provider_token;

      if (!providerToken) {
        throw new Error('Google authentication succeeded but did not yield an API access token.');
      }

      setVerifiedGoogleUser({
        email: user?.email || '',
        displayName: user?.user_metadata?.full_name || 'Authorized User',
        photoURL: user?.user_metadata?.avatar_url || null
      });
    } catch (err: any) {
      console.error("Gmail verification failure:", err);
      setReportGenState({
        status: 'error',
        error: err.message || 'Gmail Verification Cancelled or Blocked.'
      });
    } finally {
      setIsVerifyingGmail(false);
    }
  };

  const handleGenerateAndDownloadExcelReport = async () => {
    if (!selectedReportExam || !selectedReportSub) {
      alert('Please select an assessment simulation record.');
      return;
    }

    setReportGenState({
      status: 'generating',
      message: 'Provisioning secure report data block...'
    });

    try {
      const accessToken = await authenticateGoogle();
      
      setReportGenState({
        status: 'generating',
        message: 'Formatting assessment metrics payload...'
      });

      const exam = selectedReportExam ? (exams.find(e => e.id === selectedReportExam.id) || selectedReportExam) : null;
      const sub = selectedReportSub ? (submissions.find(s => s.id === selectedReportSub.id) || selectedReportSub) : null;

      if (!exam || !sub) {
        alert('Please select an assessment simulation record.');
        return;
      }

      const res = calculateSubmissionScore(exam, sub);
      const correct = sub.correctCount ?? res.correct;
      const incorrect = sub.incorrectCount ?? res.incorrect;
      const skipped = sub.skippedCount ?? res.skipped;
      const score = sub.score ?? res.score;
      const accuracy = correct + incorrect > 0 ? Math.round((correct / (correct + incorrect)) * 100) : 0;
      const formattedDate = sub.submittedAt
        ? format(toDate(sub.submittedAt), 'yyyy-MM-dd HH:mm')
        : format(new Date(), 'yyyy-MM-dd HH:mm');

      const sheetTitle = `Conqueror Assessment: ${exam.title}`;
      
      const payload = [
        ["CONQUEROR PREPARATION PLATFORM - ASSESSMENT ANALYSIS REPORT"],
        [],
        ["Candidate Name:", profile?.displayName || "Unknown Candidate"],
        ["Candidate Email:", verifiedGoogleUser?.email || profile?.email || "Unknown Email"],
        ["Assessment Title:", exam.title],
        ["Attempt Date:", formattedDate],
        ["Net Score:", `${score} / 300`],
        ["Accuracy Index:", `${accuracy}%`],
        ["Attempt Summary:", `${correct + incorrect} Questions Attempted (Correct: ${correct}, Incorrect: ${incorrect}, Skipped: ${skipped})`],
        [],
        [],
        ["Sl.No.", "Section", "Question Type", "Question ID", "Question Text", "Correct Option", "Selected Option", "Status", "Marking Awarded", "Time Spent"]
      ];

      let serial = 1;

      if (exam.sections) {
        Object.entries(exam.sections).forEach(([sectionName, section]: [string, any]) => {
          const mcqs = section.mcqs || [];
          const numericals = section.numericals || [];
          
          const allQuestions = [
            ...mcqs.map((q: any) => ({ ...q, type: 'Multiple Choice (MCQ)' })),
            ...numericals.map((q: any) => ({ ...q, type: 'Numerical Value' }))
          ];

          allQuestions.forEach((q: any) => {
            const ans = sub.answers?.[q.id];
            const correctOption = exam.answerKey[q.id];
            const isAttempted = ans?.status === 'attempted' || ans?.status === 'marked';
            const isCorrect = isAttempted && (
              typeof correctOption === 'number' 
                ? Math.abs(Number(ans?.value) - Number(correctOption)) < 0.01 
                : String(ans?.value || '').trim().toUpperCase() === String(correctOption || '').trim().toUpperCase()
            );

            let statusString = 'Skipped / Unattempted';
            let pMarking = 0;
            if (isAttempted) {
              if (isCorrect) {
                statusString = 'Correct Answer';
                pMarking = 4;
              } else {
                statusString = 'Incorrect Answer';
                pMarking = -1;
              }
            }

            const timeSpentStr = ans?.timeSpent 
              ? `${Math.floor(ans.timeSpent / 60)}m ${ans.timeSpent % 60}s`
              : 'N/A';

            let correctStr = String(correctOption ?? '');
            if (q.type === 'Multiple Choice (MCQ)' && q.options) {
              const correctIdx = String(correctOption || '').trim().toUpperCase().charCodeAt(0) - 65;
              if (correctIdx >= 0 && correctIdx < q.options.length) {
                correctStr = `${correctOption}. ${q.options[correctIdx]}`;
              }
            }

            let selectedStr = 'VOID';
            if (isAttempted) {
              const selectedVal = String(ans?.value ?? '');
              const selectedIdx = selectedVal.trim().toUpperCase().charCodeAt(0) - 65;
              if (q.type === 'Multiple Choice (MCQ)' && q.options && selectedIdx >= 0 && selectedIdx < q.options.length) {
                selectedStr = `${selectedVal}. ${q.options[selectedIdx]}`;
              } else {
                selectedStr = selectedVal;
              }
            }

            payload.push([
              serial++,
              sectionName,
              q.type,
              q.id,
              q.text || '',
              correctStr,
              selectedStr,
              statusString,
              pMarking,
              timeSpentStr
            ]);
          });
        });
      }

      setReportGenState({
        status: 'generating',
        message: 'Hosting dynamic sheet in Google Drive...'
      });

      const spreadsheet = await createSpreadsheet(sheetTitle, accessToken);
      
      setReportGenState({
        status: 'generating',
        message: 'Writing metrics data arrays...'
      });

      await populateSpreadsheet(spreadsheet.id, 'Sheet1!A1', payload, accessToken);

      const downloadUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet.id}/export?format=xlsx`;

      setReportGenState({
        status: 'completed',
        downloadUrl,
        message: 'Excel spreadsheet compiled successfully! Fetching file streaming now...'
      });

      window.open(downloadUrl, '_blank');
    } catch (err: any) {
      console.error(err);
      setReportGenState({
        status: 'error',
        error: err.message || 'Report writing pipeline faulted.'
      });
    }
  };

  useEffect(() => {
    // Fetch exams
    const fetchData = async () => {
      const { data: examData, error: examError } = await supabase
        .from('exams')
        .select('*')
        .order('created_at', { ascending: false });

      if (!examError && examData) {
        setExams(examData.map(d => mapExamRow(d as ExamRow)));
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, display_name, role');

      if (!userError && userData) {
        const usersMap: Record<string, string> = {};
        userData.forEach((u: any) => {
          usersMap[u.id] = u.role === 'admin' ? 'Admin Testing' : (u.display_name || 'Unknown Candidate');
        });
        setAllUsers(usersMap);
      }

      if (profile?.uid) {
        const { data: subData } = await supabase
          .from('submissions')
          .select('*')
          .eq('user_id', profile.uid);

        if (subData) {
          setSubmissions(subData.map(d => mapSubmissionRow(d as SubmissionRow)));
        }

        const { data: allSubData } = await supabase
          .from('submissions')
          .select('*')
          .eq('status', 'completed');

        if (allSubData) {
          setAllSubmissions(allSubData.filter((s: any) => !s.hidden).map(d => mapSubmissionRow(d as SubmissionRow)));
        }
      }

      setLoading(false);
    };

    fetchData();

    // Poll for updates
    const pollInterval = setInterval(fetchData, 15000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [profile?.uid]);

  const getStatus = (exam: Exam) => {
    const now = new Date();
    const start = toDate(exam.startTime);
    const end = toDate(exam.endTime);
    const sub = submissions.find(s => s.examId === exam.id);

    if (sub?.status === 'completed') return 'completed';
    if (sub?.status === 'started' && now >= start && now <= end) return 'ongoing';
    if (now > end) return 'expired';
    if (now >= start && now <= end) return 'live';
    return 'upcoming';
  };

  const chartData = React.useMemo(() => submissions
    .filter(s => s.status === 'completed')
    .map((s) => {
      const exam = exams.find(e => e.id === s.examId);
      if (!exam) return { ...s, calculatedScore: s.score };
      const { score } = calculateSubmissionScore(exam, s);
      return { ...s, calculatedScore: score, time: s.submittedAt?.toMillis() || 0 };
    })
    .sort((a, b) => a.time - b.time)
    .map((s, idx) => ({
      name: idx + 1,
      score: s.calculatedScore
    })), [submissions, exams]);

  const handleDeleteAccount = async () => {
    if (!profile?.uid || deleteConfirmInput.toLowerCase() !== 'delete') return;

    setIsDeleting(true);
    try {
      // 1. Purge submissions
      await supabase.from('submissions').delete().eq('user_id', profile.uid);

      // 2. Delete user profile
      await supabase.from('users').delete().eq('id', profile.uid);

      // 3. Close modal and logout
      setShowDeleteModal(false);
      logout();
    } catch (err: any) {
      console.error(err);
      alert("Account deletion failed: " + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
     return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Synchronizing Hub State</p>
        </div>
      </div>
     );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans selection:bg-blue-100 selection:text-blue-900 pb-20">
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-slate-950/95 backdrop-blur-2xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-[48px] w-full max-w-lg overflow-hidden p-12 shadow-2xl border border-red-100 relative"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-red-50 rounded-full blur-3xl opacity-50 -translate-y-1/2 translate-x-1/2" />
              
              <div className="w-16 h-16 bg-red-100 rounded-3xl flex items-center justify-center text-red-600 mb-8 mx-auto">
                <AlertTriangle size={32} />
              </div>
              
              <h2 className="text-[10px] font-black text-red-600 uppercase tracking-[0.4em] mb-4 text-center">Critical Security Override</h2>
              <h1 className="text-3xl font-black italic tracking-tighter uppercase mb-6 leading-tight text-center">
                Void Neural Profile?
              </h1>

              <div className="p-6 bg-red-50 rounded-3xl border border-red-100 mb-8">
                <p className="text-xs font-bold text-red-800 leading-relaxed">
                  Permanently purging your profile will erase ALL recorded assessments, accuracy metrics, and archival history. This sequence is irreversible.
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block italic text-center">
                    Type 'delete' to confirm account voiding
                  </label>
                  <input 
                    type="text"
                    value={deleteConfirmInput}
                    onChange={(e) => setDeleteConfirmInput(e.target.value)}
                    placeholder="ENTER COMMAND"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 md:px-6 py-3 md:py-4 text-center font-black text-lg tracking-widest focus:outline-none focus:border-red-500 transition-all text-slate-900 placeholder:text-slate-300"
                  />
                </div>

                <div className="flex flex-col md:flex-row gap-4">
                  <button 
                    disabled={isDeleting}
                    onClick={() => {
                      setShowDeleteModal(false);
                      setDeleteConfirmInput('');
                    }}
                    className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-sm hover:bg-slate-200 transition-all uppercase tracking-widest disabled:opacity-50"
                  >
                    Abort
                  </button>
                  <button 
                    disabled={deleteConfirmInput.toLowerCase() !== 'delete' || isDeleting}
                    onClick={handleDeleteAccount}
                    className="flex-[2] bg-red-600 text-white py-4 rounded-2xl font-black text-sm hover:bg-red-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-red-500/30 uppercase tracking-widest disabled:opacity-50 disabled:grayscale"
                  >
                    {isDeleting ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>EXECUTE VOID <ChevronRight size={18} strokeWidth={3} /></>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {docExportState && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[160] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-[36px] p-8 max-w-md w-full shadow-2xl relative border border-slate-100 flex flex-col text-slate-800"
            >
              <button
                onClick={() => setDocExportState(null)}
                className="absolute top-6 right-6 p-2 bg-slate-100 rounded-xl hover:bg-slate-200 transition-all text-slate-600 cursor-pointer"
              >
                <X size={16} />
              </button>

              <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 mb-6">
                <Printer size={24} />
              </div>

              <h2 className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.25em] mb-1">Documents Export Engine</h2>
              <h3 className="text-xl font-black text-slate-900 mb-2 uppercase tracking-tight">
                Export Question Paper
              </h3>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-6">
                {docExportState.exam.title}
              </p>

              <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                Choose the export channel to generate the official question paper block of this assessment, including structured section headers, question lists, options, placeholders, and a complete matching answer key matching validation matrix at the end.
              </p>

              {createdDocUrl && (
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 p-4 bg-green-50 border border-green-200 rounded-2xl text-left"
                >
                  <p className="text-[9px] font-black uppercase tracking-widest text-green-700 mb-2">Cloud Document Generated Successfully</p>
                  <a
                    href={createdDocUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 bg-green-600 hover:bg-green-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md group"
                  >
                    <span>Open Google Doc</span>
                    <ArrowUpRight size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </a>
                </motion.div>
              )}

              <div className="space-y-3">
                <button
                  disabled={isCreatingDocs}
                  onClick={async () => {
                    setIsCreatingDocs(true);
                    try {
                      const docUrl = await createGoogleDocInDrive(
                        docExportState.exam, 
                        docExportState.studentName, 
                        docExportState.studentEmail,
                        docExportState.submission
                      );
                      setCreatedDocUrl(docUrl);
                      window.open(docUrl, '_blank');
                    } catch (err: any) {
                      console.error(err);
                      alert('Failed to export to Google Drive: ' + (err.message || 'Check scopes or auth status'));
                    } finally {
                      setIsCreatingDocs(false);
                    }
                  }}
                  className="w-full flex items-center justify-between p-4 border border-indigo-150 bg-indigo-50/40 hover:bg-indigo-50 text-indigo-950 font-bold rounded-2xl cursor-pointer transition-all disabled:opacity-50 group text-left"
                >
                  <div className="text-left">
                    <p className="text-xs font-black uppercase tracking-wider">Cloud Option: Google Doc</p>
                    <p className="text-[9px] text-indigo-500 font-bold font-mono mt-0.5">Creates Document on Google Drive Hub</p>
                  </div>
                  {isCreatingDocs ? (
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-600 animate-pulse" />
                  ) : (
                    <ArrowUpRight size={16} className="text-indigo-400 group-hover:translate-x-0.5 transition-all" />
                  )}
                </button>

                <button
                  disabled={isCreatingDocs}
                  onClick={() => {
                    downloadLocalDoc(
                      docExportState.exam, 
                      docExportState.studentName, 
                      docExportState.studentEmail,
                      docExportState.submission
                    );
                    setDocExportState(null);
                  }}
                  className="w-full flex items-center justify-between p-4 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-950 font-bold rounded-2xl cursor-pointer transition-all disabled:opacity-50 group text-left"
                >
                  <div className="text-left">
                    <p className="text-xs font-black uppercase tracking-wider">Local Option: Offline Word Doc (.doc)</p>
                    <p className="text-[9px] text-slate-500 font-bold font-mono mt-0.5">Instant browser download (Compatible with Word/Pages)</p>
                  </div>
                  <Printer size={16} className="text-slate-400 group-hover:scale-105 transition-all" />
                </button>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setDocExportState(null)}
                  className="px-6 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-600 text-xs font-black uppercase tracking-widest transition-all cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {preparingExam && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-slate-950/95 backdrop-blur-2xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-[48px] w-full max-w-2xl overflow-hidden p-12 shadow-2xl border border-white/20 relative"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-50 rounded-full blur-3xl opacity-50 -translate-y-1/2 translate-x-1/2" />
              
              <h2 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em] mb-4 text-left">Secure Terminal Environment</h2>
              <h1 className="text-4xl font-black italic tracking-tighter uppercase mb-8 leading-tight text-left">
                Prepare for <span className="text-blue-600">{preparingExam.title}</span>
              </h1>

              <div className="space-y-8 mb-10">
                <div className="grid grid-cols-2 gap-6">
                  <div className="p-6 bg-slate-50 border border-slate-100 rounded-3xl text-left">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 italic text-left">Time Allocation</p>
                    <p className="text-2xl font-black text-slate-900 tracking-tighter">{preparingExam.duration} Minutes</p>
                  </div>
                  <div className="p-6 bg-slate-50 border border-slate-100 rounded-3xl text-left">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Complexity Index</p>
                    <p className="text-2xl font-black text-slate-900 tracking-tighter">Advanced</p>
                  </div>
                </div>

                <div className="p-8 bg-slate-900 rounded-[32px] text-left border border-slate-800">
                  <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-4 italic">Preparation Protocol</h3>
                  <ul className="space-y-4">
                    {[
                      'Ensure a stable high-speed neural connection.',
                      'The browser will enter secure lockdown mode.',
                      'External interruptions will void the session integrity.',
                      'Camera monitoring will be active for POV auditing.'
                    ].map((text, i) => (
                      <li key={i} className="flex items-start gap-3 text-xs font-bold text-slate-300">
                        <CheckCircle2 size={16} className="text-blue-500 shrink-0 mt-0.5" />
                        {text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => setPreparingExam(null)}
                  className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-2xl font-black text-sm hover:bg-slate-200 transition-all uppercase tracking-widest flex items-center justify-center gap-3"
                >
                  <X size={18} strokeWidth={3} /> Go Back
                </button>
                <button 
                  onClick={() => {
                    const id = preparingExam.id;
                    setPreparingExam(null);
                    onStartTest(id);
                  }}
                  className="flex-[2] bg-blue-600 text-white py-5 rounded-2xl font-black text-sm hover:bg-blue-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-blue-500/30 uppercase tracking-widest hover:-translate-y-1 active:translate-y-0"
                >
                  Initialize Secure Terminal <ChevronRight size={18} strokeWidth={3} />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {reviewExam && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 30 }}
              className="bg-white rounded-[48px] w-full max-w-6xl max-h-[85vh] overflow-hidden flex flex-col p-12 shadow-2xl relative"
            >
              <button 
                onClick={() => setReviewExam(null)}
                className="absolute top-12 right-12 p-4 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-all text-slate-600 z-10"
              >
                <X size={24} />
              </button>

              <div className="mb-12 flex justify-between items-end pr-16 bg-white shrink-0">
                <div>
                  <h2 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em] mb-4 text-left">Post-Assessment Analysis</h2>
                  <h1 className="text-5xl font-black italic tracking-tighter uppercase mb-4 leading-none text-left">
                    {reviewExam.exam.title}
                  </h1>
                </div>
                <div className="flex items-center gap-4">
                  {reviewExam.sub.integrityPhotos && reviewExam.sub.integrityPhotos.length > 0 && (
                    <button 
                      onClick={() => setShowPhotos(!showPhotos)}
                      className={cn(
                        "flex items-center gap-3 px-6 py-4 rounded-3xl font-black text-[10px] uppercase tracking-widest transition-all",
                        showPhotos ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      )}
                    >
                      <Sparkles size={16} /> My POV Audit ({reviewExam.sub.integrityPhotos.length})
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setDocExportState({
                        exam: reviewExam.exam,
                        studentName: profile?.displayName,
                        studentEmail: profile?.email,
                        submission: reviewExam.sub
                      });
                      setCreatedDocUrl(null);
                    }}
                    className="flex items-center gap-3 px-6 py-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-3xl font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap active:scale-95"
                  >
                    <Printer className="text-indigo-600" size={16} />
                    Export Question Paper to Docs
                  </button>
                </div>
                <div className="flex gap-12 bg-slate-50 p-8 rounded-3xl border border-slate-100">
                   {(() => {
                      const res = calculateSubmissionScore(reviewExam.exam, reviewExam.sub);
                      return (
                        <>
                          <div className="text-center">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Score</p>
                            <p className="text-4xl font-black text-blue-600">{res.score}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Accuracy</p>
                            <p className="text-4xl font-black text-green-600">
                               {res.correct + res.incorrect > 0 ? Math.round((res.correct / (res.correct + res.incorrect)) * 100) : 0}%
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Submitted At</p>
                            <p className="text-4xl font-black text-slate-900">{format(toDate(reviewExam.sub.submittedAt), 'HH:mm')}</p>
                          </div>
                        </>
                      );
                   })()}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                {reviewExam.exam && reviewExam.exam.sections && Object.entries(reviewExam.exam.sections).map(([sectionName, section]: [string, any]) => {
                  const questions = [...section.mcqs, ...section.numericals];
                  let correctCount = 0;
                  let score = 0;

                  questions.forEach(q => {
                    const ans = reviewExam.sub.answers?.[q.id];
                    const correct = reviewExam.exam.answerKey[q.id];
                    if (ans?.status === 'attempted' || ans?.status === 'marked') {
                      const isCorrect = typeof correct === 'number' 
                        ? Math.abs(Number(ans?.value) - Number(correct)) < 0.01 
                        : String(ans?.value).trim().toUpperCase() === String(correct).trim().toUpperCase();
                      
                      if (isCorrect) {
                        correctCount++;
                        score += 4;
                      } else {
                        score -= 1;
                      }
                    }
                  });

                  return (
                    <div key={sectionName} className="p-8 bg-slate-50 border border-slate-100 rounded-[32px] text-left">
                      <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] mb-4">{sectionName} Breakdown</h4>
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-3xl font-black text-slate-900 tracking-tighter">{score}</p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase">Points obtained</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-slate-900">{correctCount} / {questions.length}</p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Accuracy Node</p>
                        </div>
                      </div>
                      <div className="mt-6 h-1 bg-slate-200 rounded-full overflow-hidden">
                         <div className="h-full bg-blue-600" style={{ width: `${questions.length > 0 ? (correctCount/questions.length)*100 : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {showPhotos && reviewExam.sub.integrityPhotos && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="mb-12 overflow-hidden"
                >
                  <div className="bg-slate-900 p-8 rounded-[40px] border border-slate-800">
                    <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-6 italic">Visual Session Integrity Captures</h3>
                    <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar">
                      {reviewExam.sub.integrityPhotos.map((photo, i) => (
                        <div key={i} className="shrink-0 group relative">
                          <img 
                            src={photo} 
                            alt={`Audit ${i}`} 
                            className="h-32 w-auto rounded-3xl border border-white/10 hover:border-blue-500 transition-all cursor-zoom-in" 
                            onClick={() => setZoomedImage(photo)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              <div className="flex-1 overflow-y-auto pr-6 custom-scrollbar space-y-6">
                {(reviewExam.exam && reviewExam.exam.sections) && Object.values(reviewExam.exam.sections).flatMap((s: any) => [...(s.mcqs || []), ...(s.numericals || [])]).map((q, idx) => {
                  const ans = reviewExam.sub.answers?.[q.id];
                  const correct = reviewExam.exam.answerKey[q.id];
                  const isCorrect = typeof correct === 'number' 
                    ? Math.abs(Number(ans?.value) - Number(correct)) < 0.01 
                    : String(ans?.value).trim().toUpperCase() === String(correct).trim().toUpperCase();
                  const isAttempted = ans?.status === 'attempted' || ans?.status === 'marked';

                  return (
                    <div key={q.id} className="p-10 bg-slate-50 border border-slate-100 rounded-[40px] flex items-start justify-between gap-10 hover:border-blue-200 transition-all group text-left">
                      <div className="flex-1">
                         <div className="flex items-center gap-4 mb-6">
                            <span className="w-10 h-10 flex items-center justify-center bg-slate-900 text-white rounded-2xl text-xs font-black shadow-lg shadow-black/10">{idx + 1}</span>
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-white px-4 py-1.5 rounded-full border border-slate-200">Section {q.id[0]}</span>
                            {ans?.timeSpent && (
                              <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest bg-blue-50 px-4 py-1.5 rounded-full border border-blue-100 flex items-center gap-2">
                                <Clock size={10} /> {Math.floor(ans.timeSpent / 60)}m {ans.timeSpent % 60}s spent
                              </span>
                            )}
                         </div>
                         <p className="text-2xl font-black text-slate-800 italic uppercase mb-8 leading-tight tracking-tight group-hover:text-blue-600 transition-colors">
                            {q.text}
                          </p>

                          <div className="flex flex-col gap-8 mb-8">
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-8 bg-white border border-slate-200 rounded-[40px]">
                                <div>
                                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 italic">Your Selection</p>
                                   <div className={cn(
                                     "inline-block px-10 py-4 rounded-3xl text-2xl font-black italic tracking-tighter",
                                     ans?.value ? (isCorrect ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700") : "bg-slate-100 text-slate-400"
                                   )}>
                                      {ans?.value || 'VOID'}
                                   </div>
                                </div>
                                <div>
                                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 italic">Validated Solution</p>
                                   <div className="inline-block px-10 py-4 bg-blue-100 text-blue-700 rounded-3xl text-2xl font-black italic tracking-tighter">
                                      {correct}
                                   </div>
                                </div>
                             </div>
                             {ans?.timeSpent !== undefined && (
                                <div className="p-8 bg-slate-900 rounded-[40px] border border-slate-800 flex items-center justify-between shadow-2xl shadow-slate-900/40">
                                   <div>
                                      <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1 italic">Cognitive Execution Time</p>
                                      <p className="text-2xl font-black text-white italic tracking-tighter">
                                        {Math.floor(ans.timeSpent / 60)}m {ans.timeSpent % 60}s
                                      </p>
                                   </div>
                                   <div className="text-right">
                                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 italic">Performance Node</p>
                                      <p className={cn(
                                        "text-xs font-black uppercase tracking-widest",
                                        ans.timeSpent < 60 ? "text-green-500" : ans.timeSpent < 180 ? "text-yellow-500" : "text-red-500"
                                      )}>
                                        {ans.timeSpent < 60 ? 'OPTIMAL' : ans.timeSpent < 180 ? 'STANDARD' : 'CRITICAL_LATENCY'}
                                      </p>
                                   </div>
                                </div>
                             )}
                          </div>
                          {((q.imageUrls && q.imageUrls.length > 0) ? q.imageUrls : (q.imageUrl ? [q.imageUrl] : [])).length > 0 && (
                            <div className="flex flex-wrap gap-4 mb-8">
                              {((q.imageUrls && q.imageUrls.length > 0) ? q.imageUrls : [q.imageUrl]).filter(Boolean).map((url: string, imgIdx: number) => (
                                <img 
                                  key={imgIdx}
                                  src={url} 
                                  alt={`Question Attachment ${imgIdx + 1}`} 
                                  referrerPolicy="no-referrer"
                                  className="max-w-md h-auto rounded-3xl border border-slate-200" 
                                />
                              ))}
                            </div>
                          )}
                         <div className="flex gap-6">
                           {q.type === 'mcq' ? (
                             <div className="grid grid-cols-2 gap-4 w-full max-w-2xl">
                                {q.options?.map((opt: string, i: number) => {
                                  const char = String.fromCharCode(65 + i);
                                  const isUserSelected = ans?.value === char;
                                  const isActuallyCorrect = correct === char;
                                  
                                  return (
                                    <div 
                                      key={i}
                                      className={cn(
                                        "p-6 rounded-2xl border-2 text-xs font-black uppercase transition-all shadow-sm flex flex-col gap-3",
                                        isActuallyCorrect ? "bg-green-100 border-green-500 text-green-700 shadow-green-500/10" :
                                        isUserSelected ? "bg-red-100 border-red-500 text-red-700 shadow-red-500/10" :
                                        "bg-white border-slate-100 text-slate-400"
                                      )}
                                    >
                                      <div><span className="opacity-40 mr-2">{char}.</span> {opt}</div>
                                      {q.optionImages?.[i] && (
                                        <img 
                                          src={q.optionImages[i]} 
                                          alt={`Option ${char}`} 
                                          referrerPolicy="no-referrer"
                                          onClick={() => setZoomedImage(q.optionImages[i])}
                                          className="max-h-24 w-auto object-contain rounded-lg border border-white/50 cursor-zoom-in hover:opacity-90 transition-opacity" 
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                             </div>
                           ) : (
                             <div className="flex items-center gap-8">
                                <div className={cn(
                                  "p-8 rounded-3xl shadow-sm border-2",
                                  isCorrect ? "bg-green-50 border-green-200" : isAttempted ? "bg-red-50 border-red-200" : "bg-white border-slate-100"
                                )}>
                                   <p className={cn("text-[10px] font-black uppercase tracking-widest mb-2", isCorrect ? "text-green-600" : isAttempted ? "text-red-500" : "text-slate-400")}>Your Response</p>
                                   <p className={cn("text-2xl font-black", isCorrect ? "text-green-700" : isAttempted ? "text-red-700" : "text-slate-900")}>{ans?.value || 'NO_RESP'}</p>
                                </div>
                                <div className="p-8 bg-blue-50 border-2 border-blue-100 rounded-3xl shadow-sm">
                                   <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-2">Correct Answer</p>
                                   <p className="text-2xl font-black text-blue-700">{correct}</p>
                                </div>
                             </div>
                           )}
                         </div>
                      </div>
                      
                      <div className="flex flex-col items-center justify-center w-40 shrink-0 h-full mt-12">
                         {isAttempted ? (
                           isCorrect ? (
                             <div className="w-20 h-20 bg-green-500 text-white rounded-3xl flex items-center justify-center shadow-2xl shadow-green-500/30 transform group-hover:scale-110 transition-transform">
                               <CheckCircle2 size={40} strokeWidth={3} />
                             </div>
                           ) : (
                              <div className="w-20 h-20 bg-red-500 text-white rounded-3xl flex items-center justify-center shadow-2xl shadow-red-500/30 transform group-hover:scale-110 transition-transform">
                               <X size={40} strokeWidth={3} />
                             </div>
                           )
                         ) : (
                           <div className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] italic bg-slate-100 px-6 py-3 rounded-2xl">Skipped</div>
                         )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 h-20 bg-white/80 backdrop-blur-xl border-b border-slate-200 px-4 md:px-8 flex justify-between items-center z-[100]">
        <div className="flex items-center gap-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
              <BrainCircuit size={22} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-black text-slate-950 uppercase tracking-tighter leading-none">JEE - Mock Assessment</h1>
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mt-0.5">Platform v4.0</span>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-8 border-l border-slate-100 pl-10">
            {[
              { id: 'hub', label: 'Dashboard' },
              { id: 'exams', label: 'Mock Tests' },
              { id: 'compare', label: 'Compare Success' }
            ].map((item) => (
              <button 
                key={item.id} 
                onClick={() => setActiveTab(item.id as any)}
                className={cn(
                  "text-xs font-black uppercase tracking-widest transition-colors",
                  activeTab === item.id ? "text-blue-600" : "text-slate-400 hover:text-slate-900"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="md:hidden flex items-center gap-2">
            {[
              { id: 'hub', icon: <LayoutDashboard size={18} /> },
              { id: 'exams', icon: <BrainCircuit size={18} /> },
              { id: 'compare', icon: <BarChart3 size={18} /> }
            ].map((item) => (
              <button 
                key={item.id} 
                onClick={() => setActiveTab(item.id as any)}
                className={cn(
                  "p-2 rounded-xl transition-all",
                  activeTab === item.id ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-100"
                )}
              >
                {item.icon}
              </button>
            ))}
        </div>

        <div className="flex gap-4 items-center mr-8">
           <div className="flex flex-col items-end">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Efficiency Index</span>
              <span className="text-sm font-black text-blue-600 italic">
                {submissions.filter(s => s.status === 'completed').length > 0 ? (
                  <>
                    #{(() => {
                      const myMax = Math.max(...submissions.filter(s => s.status === 'completed').map(s => s.score ?? 0), 0);
                      const allMaxes = (Object.values(
                        allSubmissions.reduce((acc, s) => {
                          if (!acc[s.userId] || (s.score ?? 0) > acc[s.userId]) {
                            acc[s.userId] = s.score ?? 0;
                          }
                          return acc;
                        }, {} as Record<string, number>)
                      ) as number[]).sort((a, b) => b - a);
                      const rank = allMaxes.indexOf(myMax) + 1;
                      return rank > 0 ? rank : allMaxes.length + 1;
                    })()}
                    <span className="text-[10px] text-slate-300"> / {new Set(allSubmissions.map(s => s.userId)).size}</span>
                  </>
                ) : 'N/A'}
              </span>
           </div>
        </div>

        <div className="relative">
          <button 
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            className="flex items-center gap-4 p-1.5 pr-5 bg-slate-50 border border-slate-200 rounded-2xl hover:bg-white hover:shadow-xl hover:border-blue-200 transition-all active:scale-95"
          >
            <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center text-white font-black text-sm uppercase">
              {profile?.displayName?.[0]}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{profile?.displayName}</p>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">NODE_IDENT: {profile?.displayName}</p>
            </div>
          </button>

          <AnimatePresence>
            {showProfileMenu && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 5 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="absolute right-0 top-full mt-2 w-64 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden z-[200]"
              >
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Authenticated Account</p>
                  <p className="font-black text-slate-900 italic uppercase truncate tracking-tight">{profile?.displayName}</p>
                  <p className="text-[10px] text-slate-500 font-medium truncate mt-1">{profile?.email}</p>
                </div>
                <div className="p-3">
                  <button 
                    onClick={() => { setShowSettings(true); setShowProfileMenu(false); }}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 rounded-2xl transition-colors"
                  >
                    <span className="flex items-center gap-3"><Settings size={18} /> Settings</span>
                    <ArrowUpRight size={14} className="text-slate-300" />
                  </button>
                  <button 
                    onClick={() => { setActiveTab('history'); setShowProfileMenu(false); }}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 rounded-2xl transition-colors"
                  >
                    <span className="flex items-center gap-3"><History size={18} /> Past Tests</span>
                    <ArrowUpRight size={14} className="text-slate-300" />
                  </button>
                  <button 
                    onClick={() => { setShowDeleteModal(true); setShowProfileMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm font-black text-red-600 hover:bg-red-50 rounded-2xl transition-colors uppercase tracking-widest"
                  >
                    <Trash2 size={18} /> Delete Account
                  </button>
                  <div className="my-2 border-t border-slate-100" />
                  <button 
                    onClick={logout}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm font-black text-slate-400 hover:bg-slate-50 rounded-2xl transition-colors uppercase tracking-widest"
                  >
                    <LogOut size={18} /> Termination Session
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {showSettings && (
        <SettingsModal 
          user={auth.currentUser} 
          profile={profile} 
          onClose={() => setShowSettings(false)} 
        />
      )}

      <main className="flex-1 w-full max-w-[1440px] mx-auto p-4 md:p-12 mt-20 pt-10 md:pt-20">
        <AnimatePresence mode="wait">
          {activeTab === 'compare' ? (
            <motion.div 
              key="compare"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12"
            >
               <div className="flex justify-between items-end mb-12">
                <div>
                  <h2 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em] mb-4">Neural Benchmarking Hub</h2>
                  <h1 className="text-6xl font-black italic tracking-tighter uppercase leading-none">Compare Performance</h1>
                </div>
                <div className="bg-slate-900 text-white px-8 py-4 rounded-3xl flex items-center gap-4">
                  <Trophy className="text-blue-400" size={24} />
                  <div>
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1">Total Contributors</p>
                    <p className="text-2xl font-black tracking-tighter leading-none">{new Set(allSubmissions.map(s => s.userId)).size}</p>
                  </div>
                </div>
              </div>
              

              <div className="grid grid-cols-1 gap-12">
                <div className="space-y-12">
                  <section className="bg-white border border-slate-200 rounded-[48px] p-12 shadow-sm">
                    <div className="flex items-center justify-between mb-10">
                      <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] italic">Cohort Performance Analysis</h3>
                      <div className="flex gap-4">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-blue-600 rounded-full" />
                          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">You</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-slate-300 rounded-full" />
                          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Others</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-16">
                       {exams.map(exam => {
                        const examSubs = allSubmissions.filter(s => s.examId === exam.id).sort((a,b) => (b.score ?? 0) - (a.score ?? 0));
                        if (examSubs.length === 0) return null;

                        const mySub = submissions.find(s => s.examId === exam.id && s.status === 'completed');
                        const myScore = mySub?.score ?? 0;
                        
                        const examChartData = examSubs.map((s, idx) => ({
                          name: allUsers[s.userId] || s.userName || `ID_${idx + 1}`,
                          score: s.score ?? 0,
                          isMe: s.userId === profile?.uid
                        }));

                        // Rank-based Percentile for summary
                        const myRank = examSubs.findIndex(s => s.userId === profile?.uid) + 1;
                        const percentile = examSubs.length > 1 && myRank > 0 
                          ? Math.round(((examSubs.length - myRank) / (examSubs.length - 1)) * 100) 
                          : (myRank === 1 ? 100 : 0);

                        return (
                           <div key={exam.id} className="p-10 bg-slate-50 border border-slate-100 rounded-[40px] hover:border-blue-400 transition-all group">
                              <div className="flex justify-between items-start mb-8">
                                <div>
                                  <h4 className="text-2xl font-black text-slate-900 uppercase italic tracking-tight mb-2 group-hover:text-blue-600 transition-colors uppercase">{exam.title}</h4>
                                  <div className="flex gap-4">
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic">{examSubs.length} Diagnostic Cycles Recorded</p>
                                    <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest italic">{percentile}% Global Percentile</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Peak Score</p>
                                  <p className="text-4xl font-black text-slate-900 tracking-tighter italic">{Math.max(...examSubs.map(s => s.score ?? 0), 0)}</p>
                                </div>
                              </div>
                              
                              <div className="h-[300px] w-full mt-8">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={examChartData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis 
                                      dataKey="name" 
                                      axisLine={false}
                                      tickLine={false}
                                      hide={examChartData.length > 15}
                                      tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }}
                                    />
                                    <YAxis 
                                      axisLine={false}
                                      tickLine={false}
                                      tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }} 
                                      domain={[0, 300]} 
                                    />
                                    <Tooltip 
                                      cursor={{ fill: '#f1f5f9', radius: 12 }}
                                      contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.15)', background: '#0f172a', color: 'white', padding: '16px' }}
                                      itemStyle={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}
                                      labelStyle={{ fontSize: '12px', fontWeight: 900, marginBottom: '8px', color: '#60a5fa' }}
                                    />
                                    <Bar dataKey="score" radius={[12, 12, 0, 0]} barSize={examChartData.length > 10 ? undefined : 60}>
                                      {examChartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.isMe ? '#2563eb' : '#cbd5e1'} />
                                      ))}
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>

                              <div className="mt-8 pt-8 border-t border-slate-200/50 flex justify-between items-center">
                                <div className="flex gap-8">
                                  <div>
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Your Rank</p>
                                    <p className="text-xl font-black text-blue-600 italic">#{myRank || 'N/A'}</p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Your Score</p>
                                    <p className="text-xl font-black text-slate-900 italic">{myScore || '--'}</p>
                                  </div>
                                </div>
                                <div className="p-3 bg-white border border-slate-200 rounded-2xl flex items-center gap-3">
                                  <Trophy size={14} className="text-blue-500" />
                                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest italic">Position: {myRank === 1 ? 'Alpha Node' : 'Analyzing Path'}</span>
                                </div>
                              </div>
                           </div>
                         );
                       })}
                    </div>
                  </section>
                </div>

                <div className="lg:col-span-4 space-y-12">


                   <section className="bg-white border border-slate-200 rounded-[48px] p-12 shadow-sm">
                      <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] mb-8">Performance Insight</h3>
                      <div className="space-y-8">
                         <div className="p-8 bg-blue-50 border border-blue-100 rounded-[32px]">
                            <p className="text-xl font-black italic text-blue-900 leading-snug">"Your accuracy in Physics sessions is currently outperforming 82% of the global cohort."</p>
                         </div>
                         <div className="flex items-center gap-4 px-4">
                            <Activity className="text-blue-600" size={20} />
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Calibration: High Integrity</p>
                         </div>
                      </div>
                   </section>
                </div>
              </div>
            </motion.div>
          ) : activeTab === 'hub' ? (
            <motion.div 
              key="hub"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 xl:grid-cols-12 gap-16"
            >
              {/* Left Column: Welcome & Tests */}
              <div className="xl:col-span-8 space-y-16">
            <header className="relative">
              <div className="absolute -top-10 -left-10 w-24 h-24 bg-blue-100 rounded-full blur-3xl opacity-50" />
              <h2 className="text-6xl font-black text-slate-900 tracking-tighter mb-4 uppercase italic leading-none">
                Welcome back, <span className="text-blue-600">{profile?.displayName?.split(' ')[0]}</span>
              </h2>
              <p className="text-slate-500 text-lg font-medium leading-relaxed max-w-2xl">
                Ready for your daily breakthrough? Our latest JEE Advanced Mock Session is now available. Stay focused, maintain integrity.
              </p>
              
              <div className="flex gap-4 mt-8">
                 <div className="bg-slate-900 text-white px-6 py-3 rounded-2xl flex items-center gap-3 shadow-xl shadow-slate-900/20 active:scale-95 transition-transform cursor-pointer">
                    <Sparkles size={18} className="text-blue-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Next Scheduled: 10:00 AM Today</span>
                 </div>
              </div>
            </header>

            <section>
              <div className="flex items-center justify-between mb-8 border-b border-slate-200 pb-4">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-3">
                   Active Assessment Terminal
                </h3>
                <span className="text-[10px] font-black bg-blue-100 text-blue-700 px-3 py-1 rounded-full uppercase">{exams.length} Tests Found</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {exams.map((exam) => {
                  const status = getStatus(exam);
                  const sub = submissions.find(s => s.examId === exam.id);
                  
                  return (
                    <motion.div 
                      key={exam.id}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      className="group bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm hover:shadow-2xl hover:border-blue-400 transition-all relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full translate-x-1/2 -translate-y-1/2 group-hover:scale-150 transition-transform duration-700" />
                      
                      <div className="flex justify-between items-start mb-10 relative z-10">
                        <div className="w-14 h-14 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-blue-600 group-hover:border-blue-200 transition-colors">
                           <Calendar size={24} />
                        </div>
                        {status === 'live' && (
                          <div className="flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 rounded-xl text-[10px] font-black uppercase tracking-widest animate-pulse border border-green-200">
                             Live Terminal
                          </div>
                        )}
                        {status === 'upcoming' && (
                          <div className="px-3 py-1 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-100">
                             Standard Queue
                          </div>
                        )}
                        {status === 'expired' && (
                          <div className="px-3 py-1 bg-slate-100 text-slate-400 rounded-xl text-[10px] font-black uppercase tracking-widest border border-slate-200">
                             Closed
                          </div>
                        )}
                      </div>

                      <div className="relative z-10">
                        <h4 className="text-2xl font-black text-slate-900 mb-3 uppercase italic tracking-tighter leading-none group-hover:text-blue-600 transition-colors">{exam.title}</h4>
                        <div className="flex flex-wrap gap-4 mb-10">
                           <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase">
                             <Clock size={12} strokeWidth={3} /> {exam.duration} Minutes Session
                           </div>
                           <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase">
                              <BrainCircuit size={12} strokeWidth={3} /> 75-Questions Advanced
                           </div>
                        </div>

                        <div className="pt-8 border-t border-slate-100 flex items-center justify-between">
                          {status === 'completed' ? (
                            <div className="w-full flex flex-col gap-4">
                               <div className="flex items-center justify-between p-6 bg-green-50 border border-green-200 rounded-3xl">
                                 <div>
                                   <p className="text-[10px] font-black text-green-600 uppercase tracking-widest mb-1 italic">Diagnostic Outcome</p>
                                   <div className="flex items-baseline gap-2">
                                     <span className="text-4xl font-black text-green-700 tracking-tighter">
                                       {(() => {
                                          const res = calculateSubmissionScore(exam, sub!);
                                          return sub!.score ?? res.score;
                                       })()}
                                     </span>
                                     <span className="text-sm font-black text-green-600 opacity-40">/ 300</span>
                                   </div>
                                 </div>
                                 <Trophy className="text-green-500" size={32} />
                               </div>
                               <button 
                                 onClick={() => setReviewExam({exam, sub: sub!})}
                                 className="w-full py-5 bg-slate-900 shadow-xl shadow-slate-900/10 text-white rounded-2xl font-black text-sm hover:bg-blue-600 transition-all flex items-center justify-center gap-3 uppercase tracking-widest"
                               >
                                 <FileText size={18} /> View Rated Paper
                               </button>
                            </div>
                          ) : (status === 'live' || status === 'ongoing') ? (
                            <button 
                              onClick={() => {
                                if (status === 'ongoing') {
                                  onStartTest(exam.id);
                                } else {
                                  setPreparingExam(exam);
                                }
                              }}
                              className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-sm hover:bg-blue-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-blue-500/30 uppercase tracking-widest hover:-translate-y-1 active:translate-y-0"
                            >
                              {status === 'ongoing' ? 'RESUME PROTOCOL' : 'INITIALIZE PROTOCOL'} <ChevronRight size={18} strokeWidth={3} />
                            </button>
                          ) : status === 'upcoming' ? (
                            <div className="w-full text-center py-4 bg-slate-100/50 rounded-2xl text-[10px] font-black text-slate-400 uppercase tracking-widest border-2 border-dashed border-slate-200">
                               Session opens at {format(toDate(exam.startTime), 'p')}
                            </div>
                          ) : (
                            <div className="w-full text-center py-4 bg-slate-50 rounded-2xl text-[10px] font-black text-slate-300 uppercase tracking-widest italic">
                               Attempt Period Expired
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
                {exams.length === 0 && (
                   <div className="col-span-2 py-20 text-center bg-white rounded-[32px] border-2 border-dashed border-slate-200">
                      <LayoutDashboard size={48} className="mx-auto text-slate-200 mb-4" />
                      <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">No active exams in terminal queue</p>
                   </div>
                )}
              </div>
            </section>
          </div>

          {/* Right Column: Intelligence Metrics */}
          <div className="xl:col-span-4 space-y-12">
            <section className="bg-white border border-slate-200 rounded-[40px] p-10 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-40 h-40 bg-blue-50/50 rounded-full -translate-y-1/2 translate-x-1/2" />
              
              <div className="relative z-10">
                <header className="mb-12">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] mb-4">Integrity Metrics</h3>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-5xl font-black text-slate-900 tracking-tighter">
                        {chartData.length ? Math.round(chartData.reduce((a, b) => a + (b.score || 0), 0) / chartData.length) : 0}
                      </p>
                      <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-1 italic">Average Aggregate Score</p>
                    </div>
                    <div className="bg-slate-900 text-white w-12 h-12 rounded-2xl flex items-center justify-center font-black">
                       <Trophy size={20} />
                    </div>
                  </div>
                </header>
                
                <div className="mb-12 h-64 w-full">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" hide />
                        <YAxis hide domain={[0, 300]} />
                        <Tooltip 
                          cursor={{ stroke: '#2563eb', strokeWidth: 2 }}
                          contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.15)', background: '#0f172a', color: 'white' }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="score" 
                          stroke="#2563eb" 
                          strokeWidth={4} 
                          fillOpacity={1} 
                          fill="url(#colorScore)"
                          activeDot={{ r: 8, fill: '#2563eb', stroke: 'white', strokeWidth: 4 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center border-2 border-dashed border-slate-100 rounded-3xl bg-slate-50/50">
                       <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic">Awaiting initial diagnostics...</p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="p-6 bg-slate-50 border border-slate-100 rounded-3xl">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Unit</p>
                    <p className="text-3xl font-black text-slate-900 tracking-tighter">{chartData.length}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase mt-4">Sessions Recorded</p>
                  </div>
                  <div className="p-6 bg-slate-900 text-white rounded-3xl shadow-xl shadow-slate-900/20">
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Peak Index</p>
                    <p className="text-3xl font-black text-white tracking-tighter">
                       {chartData.length ? Math.max(...chartData.map(d => d.score)) : 0}
                    </p>
                    <p className="text-[9px] font-bold text-slate-500 uppercase mt-4">Maximum Efficiency</p>
                  </div>
                </div>

                <div className="mt-10 pt-10 border-t border-slate-100">
                    <button 
                      onClick={() => setActiveTab('report')}
                      className="w-full flex items-center justify-center gap-3 text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] py-4 bg-blue-50 border border-blue-100 rounded-2xl hover:bg-blue-600 hover:text-white transition-all cursor-pointer"
                    >
                       Download Detailed Report <ArrowUpRight size={14} />
                    </button>
                </div>
              </div>
            </section>

            <section className="bg-slate-900 rounded-[40px] p-10 text-white relative overflow-hidden group border border-slate-800">
               <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-blue-600 rounded-full blur-[100px] opacity-20 group-hover:opacity-40 transition-opacity" />
               <h4 className="text-xs font-black text-blue-400 uppercase tracking-[0.3em] mb-6">Preparation Intelligence</h4>
               <p className="text-xl font-black italic tracking-tight leading-relaxed mb-10">
                 "Consistent simulation is the ONLY architecture that supports high-pressure success. No excuses."
               </p>
               <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                     <LayoutDashboard size={20} className="text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest">Platform AI Coach</p>
                    <p className="text-[10px] font-medium text-slate-500 uppercase">System Status: Optimizing Path</p>
                  </div>
               </div>
            </section>
          </div>
            </motion.div>
          ) : activeTab === 'report' ? (
            <motion.div 
              key="report"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="space-y-10 max-w-[1400px] mx-auto text-left"
            >
              <div className="px-6">
                <button 
                  onClick={() => setActiveTab('hub')} 
                  className="group flex items-center gap-2 text-slate-400 hover:text-slate-900 text-xs font-black uppercase tracking-widest transition-colors mb-6 cursor-pointer"
                >
                  ← Back to Dashboard
                </button>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                  <div>
                    <h2 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em] mb-2">Secure Export Hub</h2>
                    <h1 className="text-5xl font-black italic tracking-tighter uppercase leading-none mb-4">Excel Report Engine</h1>
                    <p className="text-sm font-medium text-slate-500 max-w-[700px]">
                      Authenticates your identity via Google Sync, compiles complete assessment analytics dynamically, and exports interactive worksheets into Excel (.xlsx) formats.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 px-6">
                {/* Step 1: Assessment Selector Panel */}
                <div className="lg:col-span-7 space-y-6">
                  <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 italic">Step 1: Select Simulation Attempt</h3>
                    
                    {submissions.filter(s => s.status === 'completed').length === 0 ? (
                      <div className="border border-dashed border-slate-200 rounded-3xl p-12 text-center space-y-6 bg-slate-50/50">
                        <AlertTriangle className="mx-auto text-amber-500" size={40} />
                        <div>
                          <p className="text-sm font-black text-slate-900 uppercase tracking-tight mb-1">No Completed Attempts Found</p>
                          <p className="text-xs text-slate-400">You must finalize and submit at least one exam simulation sequence before downloading detailed diagnostics.</p>
                        </div>
                        <button 
                          onClick={() => setActiveTab('exams')} 
                          className="px-6 py-3.5 bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20 active:scale-[0.98]"
                        >
                          Launch Mock Diagnostics
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                        {submissions
                          .filter(s => s.status === 'completed')
                          .sort((a,b) => (b.submittedAt?.toMillis() || 0) - (a.submittedAt?.toMillis() || 0))
                          .map((sub) => {
                            const exam = exams.find(e => e.id === sub.examId);
                            const isSelected = selectedReportSub?.id === sub.id;
                            const res = exam ? calculateSubmissionScore(exam, sub) : { score: 0, correct: 0, incorrect: 0, skipped: 0 };
                            const score = sub.score ?? res.score;
                            const correct = sub.correctCount ?? res.correct;
                            const dateFormatted = sub.submittedAt
                              ? format(toDate(sub.submittedAt), 'MMMM d, yyyy @ HH:mm')
                              : 'Unknown Date';

                            return (
                              <button
                                key={sub.id}
                                onClick={() => {
                                  setSelectedReportExam(exam || null);
                                  setSelectedReportSub(sub);
                                  if (reportGenState.status === 'completed') {
                                    setReportGenState({ status: 'idle' });
                                  }
                                }}
                                className={cn(
                                  "w-full p-6 rounded-2xl border text-left transition-all relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer",
                                  isSelected 
                                    ? "bg-blue-50/80 border-blue-600 shadow-lg shadow-blue-500/5 ring-1 ring-blue-600" 
                                    : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/55"
                                )}
                              >
                                <div className="space-y-2">
                                  <div className="flex items-center gap-3">
                                    <div className={cn(
                                      "w-2.5 h-2.5 rounded-full",
                                      isSelected ? "bg-blue-600" : "bg-slate-300"
                                    )} />
                                    <h4 className="font-black text-slate-900 tracking-tight leading-none text-base">
                                      {exam?.title || 'Unknown Exam Simulation'}
                                    </h4>
                                  </div>
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-5">
                                    <span>Date: {dateFormatted}</span>
                                    <span>•</span>
                                    <span>Correct: <strong className="text-slate-600">{correct}</strong></span>
                                  </div>
                                </div>

                                <div className="shrink-0 flex items-center gap-4 pl-5 md:pl-0">
                                  <div className="text-right">
                                    <p className="text-xs font-extrabold text-slate-400 uppercase tracking-widest">Net Score</p>
                                    <p className={cn(
                                      "text-xl font-black tracking-tight leading-none",
                                      isSelected ? "text-blue-700" : "text-slate-900"
                                    )}>
                                      {score} <span className="text-xs font-bold text-slate-400">/ 300</span>
                                    </p>
                                  </div>
                                  <ChevronRight size={18} className={cn(
                                    "transition-transform",
                                    isSelected ? "text-blue-600 translate-x-1" : "text-slate-300"
                                  )} />
                                </div>
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Panel: Verification and Download Actions */}
                <div className="lg:col-span-5 space-y-6">
                  {/* Step 2 Panel: Gmail Verification */}
                  <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm text-left">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 italic">Step 2: Sign-In Gmail Verification</h3>
                    
                    {verifiedGoogleUser ? (
                      <div className="space-y-6">
                        <div className="p-6 bg-green-50/70 border border-green-100 rounded-2xl flex items-center gap-4 animate-fadeIn animate-duration-300">
                          <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center text-white shrink-0">
                            <CheckCircle2 size={24} strokeWidth={2.5} />
                          </div>
                          <div className="space-y-1 overflow-hidden">
                            <p className="text-[10px] font-black text-green-600 uppercase tracking-[0.15rem]">Gmail Scope Secured</p>
                            <p className="text-sm font-black text-slate-900 truncate">{verifiedGoogleUser.email}</p>
                            {verifiedGoogleUser.displayName && (
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{verifiedGoogleUser.displayName}</p>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex justify-end">
                          <button 
                            type="button"
                            onClick={handleGmailVerification}
                            className="text-[9px] font-black text-slate-400 hover:text-slate-900 uppercase tracking-widest transition-colors cursor-pointer"
                          >
                            Switch Account / Re-Verify
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <p className="text-xs font-bold text-slate-500 leading-relaxed">
                          To safely execute external sheets compilation and write directly onto Google Cloud components, you must approve Gmail identity validation.
                        </p>
                        
                        <button
                          type="button"
                          disabled={isVerifyingGmail}
                          onClick={handleGmailVerification}
                          className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 px-6 rounded-2xl font-black text-xs uppercase tracking-[0.12em] transition-all flex items-center justify-center gap-3 shadow-md active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                        >
                          {isVerifyingGmail ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" fill="#FBBC05"/>
                              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                            </svg>
                          )}
                          <span>Validate & Verify via Gmail</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Step 3 Panel: Assembly & Export Initiation */}
                  <div className="bg-white border border-slate-200 rounded-[32px] p-8 shadow-sm text-left">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 italic">Step 3: Excel Compiler</h3>
                    
                    <div className="space-y-6">
                      <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl space-y-2">
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-wider">
                          <span className="text-slate-400">Selected Simulation</span>
                          <span className={cn(selectedReportExam ? "text-blue-600" : "text-amber-500")}>
                            {selectedReportExam ? "Ready" : "Pending Item"}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-slate-800 truncate">
                          {selectedReportExam ? selectedReportExam.title : "No test selected yet (choose from Step 1)"}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={!selectedReportExam || !verifiedGoogleUser || reportGenState.status === 'generating'}
                        onClick={handleGenerateAndDownloadExcelReport}
                        className={cn(
                          "w-full py-4 px-6 rounded-2xl font-black text-xs uppercase tracking-[0.12em] transition-all flex items-center justify-center gap-3 shadow-lg cursor-pointer",
                          (!selectedReportExam || !verifiedGoogleUser)
                            ? "bg-slate-100 text-slate-400 border border-slate-200/60 cursor-not-allowed shadow-none"
                            : "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 active:scale-[0.98]"
                        )}
                      >
                        {reportGenState.status === 'generating' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <FileText size={16} />
                        )}
                        <span>Download Excel Sheet</span>
                      </button>

                      {/* Display Progress Log / Status Output */}
                      {reportGenState.status !== 'idle' && (
                        <div className="mt-4 p-5 rounded-2xl border border-slate-100 text-xs font-bold bg-slate-50/70 space-y-4">
                          <div className="flex items-center gap-3">
                            {reportGenState.status === 'generating' && (
                              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                            )}
                            {reportGenState.status === 'completed' && (
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            )}
                            {reportGenState.status === 'error' && (
                              <AlertTriangle className="w-4 h-4 text-red-600" />
                            )}
                            <p className={cn(
                              "font-black uppercase tracking-wider text-[10px]",
                              reportGenState.status === 'completed' ? "text-green-600" : 
                              reportGenState.status === 'error' ? "text-red-600" : "text-slate-500"
                            )}>
                              {reportGenState.status === 'generating' ? 'STREAMING DATA BLOCKS' : 
                               reportGenState.status === 'completed' ? 'DOWNLOAD STREAM READY' : 'PIPELINE CRITICAL FAULT'}
                            </p>
                          </div>
                          
                          <p className="text-slate-600 leading-relaxed font-black">
                            {reportGenState.message || reportGenState.error}
                          </p>

                          {reportGenState.status === 'completed' && reportGenState.downloadUrl && (
                            <div className="pt-2 border-t border-slate-200 flex flex-col gap-2">
                              <p className="text-[10px] text-slate-400">Did the download not trigger automatically?</p>
                              <a
                                href={reportGenState.downloadUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:underline flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
                              >
                                Direct External Download Link <ArrowUpRight size={12} />
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : activeTab === 'exams' ? (
            <motion.div 
              key="exams"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="space-y-12 max-w-6xl mx-auto text-left"
        >
          <h2 className="text-4xl font-black uppercase italic tracking-tighter pl-6 border-l-4 border-blue-600">Mock Examination Portals</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-20">
             {exams.map(exam => {
               const status = getStatus(exam);
               const sub = submissions.find(sub => sub.examId === exam.id);
               return (
                 <motion.div 
                   key={exam.id}
                   whileHover={{ y: -5 }}
                   className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm relative overflow-hidden group hover:border-blue-400 transition-all text-left"
                 >
                    <div className="flex justify-between items-start mb-8">
                       <span className={cn(
                         "px-3 py-1 text-[9px] font-black rounded-full uppercase tracking-widest",
                         status === 'live' ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                       )}>{status}</span>
                       <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400">
                          <FileText size={18} />
                       </div>
                    </div>
                    <h3 className="text-2xl font-black text-slate-900 uppercase italic tracking-tight leading-none mb-4 group-hover:text-blue-600 transition-colors">{exam.title}</h3>
                    <div className="space-y-3 mb-8">
                       <div className="flex items-center gap-3 text-xs font-bold text-slate-400 uppercase tracking-widest">
                          <Clock size={14} /> {exam.duration} Minutes
                       </div>
                       <div className="flex items-center gap-3 text-xs font-bold text-slate-400 uppercase tracking-widest">
                          <BrainCircuit size={14} /> Logic Integrity Protocol
                       </div>
                    </div>
                    {sub?.status === 'completed' ? (
                          <div className="w-full flex flex-col gap-4 pt-6 border-t border-slate-100">
                             <div className="flex items-center justify-between p-6 bg-green-50 border border-green-100 rounded-3xl">
                                <div className="flex flex-col">
                                   <span className="text-[10px] font-black text-green-600 uppercase tracking-widest leading-none mb-1 italic">Diagnostic Score Index</span>
                                   <div className="flex items-baseline gap-2">
                                      {(() => {
                                         const res = calculateSubmissionScore(exam, sub!);
                                         return (
                                           <>
                                             <span className="text-3xl font-black text-green-700 tracking-tighter leading-none">{sub!.score ?? res.score}</span>
                                             <span className="text-xs font-black text-green-600 opacity-40">/ 300</span>
                                           </>
                                         );
                                      })()}
                                   </div>
                                </div>
                                <Trophy className="text-green-500" size={32} />
                             </div>
                             <button 
                               onClick={() => setReviewExam({exam, sub: sub!})}
                               className="w-full py-4 bg-slate-900 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-blue-600 transition-all flex items-center justify-center gap-2 shadow-2xl shadow-slate-900/10"
                             >
                                <FileText size={16} /> Review Assessment Paper
                             </button>
                          </div>
                    ) : (
                      <button 
                        disabled={status !== 'live' && status !== 'ongoing'}
                        onClick={() => {
                          if (status === 'ongoing') {
                            onStartTest(exam.id);
                          } else {
                            setPreparingExam(exam);
                          }
                        }}
                        className={cn(
                          "w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all",
                          (status === 'live' || status === 'ongoing') ? "bg-blue-600 text-white shadow-xl shadow-blue-600/30 hover:-translate-y-1" : "bg-slate-100 text-slate-400 cursor-not-allowed"
                        )}
                      >
                         {status === 'ongoing' ? 'Resume Session' : status === 'live' ? 'Initialize Session' : 'Locked'}
                      </button>
                    )}
                  </motion.div>
               );
             })}
          </div>
            </motion.div>
          ) : false && activeTab === 'surf' ? (
            <motion.div
              key="surf"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              null
            </motion.div>
          ) : null}
        </AnimatePresence>
  <ReviewButton />
  </main>
    </div>
  );
}
