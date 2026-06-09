import React, { useState, useEffect, useRef } from 'react';
import { supabase, mapExamRow, mapUserRow, mapSubmissionRow, ExamRow, UserRow, SubmissionRow } from '../lib/supabase';
import { handleFirestoreError, OperationType, removeUndefined } from '../lib/firestoreUtils';
import { useAuth } from '../context/AuthContext';
import { Exam, UserProfile, Submission } from '../types';
import { calculateSubmissionScore } from '../lib/scoreUtils';
import { Users, Plus, ChartBar as BarChart2, Settings, LogOut, Clock, Calendar, Copy, FileText, Loader as Loader2, Trash2, TrendingUp, Search, History, User as UserIcon, TriangleAlert as AlertTriangle, X, CircleCheck as CheckCircle2, ChevronRight, Activity, Eye, BrainCircuit, ChartBar as BarChart3, Trophy, ArrowUpRight, Sparkles, FileUp, Keyboard, Check, CircleAlert as AlertCircle, Menu, Printer, Globe } from 'lucide-react';
import { GlassButton } from '../components/ui/apple-tahoe-liquid-glass-button';
import SettingsModal from '../components/SettingsModal';
import { ReviewButton } from '../components/ReviewButton';
import { format, addHours } from 'date-fns';
import { cn } from '../lib/utils';
import { compressImage } from '../lib/imageUtils';
import { motion, AnimatePresence } from 'motion/react';
import { authenticateGoogle, createSpreadsheet, populateSpreadsheet } from '../lib/googleSheets';
import { downloadLocalDoc, createGoogleDocInDrive } from '../lib/googleDocs';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

const MATH_SYMBOLS = ['π', '√', '²', '³', '∞', '±', '×', '÷', 'α', 'β', 'γ', 'σ', 'λ', 'ρ', 'τ', 'φ', 'θ', 'Δ', 'Σ', 'Ω', 'μ', 'ε', '∫', '≈', '≠', '≤', '≥', '°', '^', '_', '∕', '⁰', '¹', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹', '∩'];

const NeuralKeypad = ({ insertSymbol }: { insertSymbol: (s: string) => void }) => (
  <div className="bg-slate-900 p-6 rounded-3xl shadow-2xl border border-slate-700 h-full flex flex-col gap-6">
    <div className="flex items-center gap-3">
      <Keyboard className="text-blue-400" size={24} />
      <span className="text-xs font-black text-slate-400 uppercase tracking-widest text-center">Neural Keypad</span>
    </div>
    <div className="grid grid-cols-4 gap-3 overflow-y-auto">
      {MATH_SYMBOLS.map(sym => (
        <button 
          key={sym}
          onClick={() => insertSymbol(sym)}
          className="w-12 h-12 bg-white border border-slate-200 rounded-2xl flex items-center justify-center text-lg font-black text-slate-800 hover:bg-blue-600 hover:text-white hover:border-blue-700 transition-all active:scale-90 shadow-sm"
        >
          {sym}
        </button>
      ))}
    </div>
  </div>
);

export default function AdminDashboard({ onStartTest }: { onStartTest: (id: string) => void }) {
  const { user, profile, logout } = useAuth();
  const isOwner = profile?.email === 'admin123@gmail.com';
  const isGlobalAdmin = isOwner || profile?.email === 'jeswinsamuel.la@gmail.com';
  const isSuperAdmin = isGlobalAdmin || profile?.role === 'admin';
  const canModifyExams = isSuperAdmin;
  const canDeleteUsers = isSuperAdmin;
  const isDataViewerOnly = !isSuperAdmin;
  
  const [exams, setExams] = useState<Exam[]>([]);
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [admins, setAdmins] = useState<UserProfile[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [activeTab, setActiveTab] = useState<'exams' | 'students' | 'admins' | 'stats' | 'performance' | 'monitor' | 'submissions' | 'reviews'>('exams');
  const [purgeInput, setPurgeInput] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [reviewSubmission, setReviewSubmission] = useState<{exam: Exam, sub: Submission, student: UserProfile} | null>(null);
  const [reportSelectStudent, setReportSelectStudent] = useState<UserProfile | null>(null);
  const [showSectionMetrics, setShowSectionMetrics] = useState(false);
  const [docExportState, setDocExportState] = useState<{ exam: Exam, studentName?: string, studentEmail?: string } | null>(null);
  const [exportState, setExportState] = useState<{ isLoading: boolean; url: string | null; error: string | null }>({
    isLoading: false,
    url: null,
    error: null
  });
  const [isCreatingDocs, setIsCreatingDocs] = useState(false);
  const [createdDocUrl, setCreatedDocUrl] = useState<string | null>(null);
  const [analyzingExam, setAnalyzingExam] = useState<Exam | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewHoldExam, setPreviewHoldExam] = useState<string | null>(null);
  const [deleteHoldExamId, setDeleteHoldExamId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [deleteHoldProgress, setDeleteHoldProgress] = useState(0);
  const [examFilter, setExamFilter] = useState<string>('all');
  const [isDraggingAny, setIsDraggingAny] = useState(false);
  const [isOverTrash, setIsOverTrash] = useState(false);
  const trashRef = useRef<HTMLDivElement>(null);
  const holdIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const deleteHoldIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const examDraftRef = useRef({
    title: '',
    duration: '180',
    startTime: '',
    endTime: '',
    sections: {
      Maths: { mcqs: [], numericals: [] },
      Physics: { mcqs: [], numericals: [] },
      Chemistry: { mcqs: [], numericals: [] }
    }
  });

  // Form State
  const [examTitle, setExamTitle] = useState('');
  const [examDuration, setExamDuration] = useState('180');
  const [startTime, setStartTime] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [endTime, setEndTime] = useState(format(addHours(new Date(), 24), "yyyy-MM-dd'T'HH:mm"));
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  
  const [showCreateStudentModal, setShowCreateStudentModal] = useState(false);
  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [newStudentPassword, setNewStudentPassword] = useState('');
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentPrepType, setNewStudentPrepType] = useState<'JEE' | 'NEET' | 'Both'>('JEE');
  const [newStudentRole, setNewStudentRole] = useState<'student' | 'admin'>('student');
  const [isCreatingStudent, setIsCreatingStudent] = useState(false);
  
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [examToDelete, setExamToDelete] = useState<Exam | null>(null);
  const [adminDeleteConfirm, setAdminDeleteConfirm] = useState('');
  const [examDeleteConfirm, setExamDeleteConfirm] = useState('');
  const [isPurging, setIsPurging] = useState(false);
  const [draggedOptionIdx, setDraggedOptionIdx] = useState<number | null>(null);
  const [draggedQId, setDraggedQId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [preparationTypeExam, setPreparationTypeExam] = useState<'JEE' | 'NEET' | 'Both'>('JEE');

  const handleExportAssessment = async (exam: Exam, sub: Submission, student: UserProfile) => {
    setExportState({ isLoading: true, url: null, error: null });
    try {
      const accessToken = await authenticateGoogle();
      
      const res = calculateSubmissionScore(exam, sub);
      const correct = sub.correctCount ?? res.correct;
      const incorrect = sub.incorrectCount ?? res.incorrect;
      const skipped = sub.skippedCount ?? res.skipped;
      const score = sub.score ?? res.score;
      const accuracy = correct + incorrect > 0 ? Math.round((correct / (correct + incorrect)) * 100) : 0;
      const formattedDate = sub.submittedAt 
        ? format(sub.submittedAt.toDate(), 'yyyy-MM-dd HH:mm')
        : format(new Date(), 'yyyy-MM-dd HH:mm');

      const sheetTitle = `Conqueror Assessment: ${exam.title} - ${student.displayName}`;
      
      const payload = [
        ["CONQUEROR PREPARATION PLATFORM - ASSESSMENT ANALYSIS REPORT"],
        [],
        ["Candidate Name:", student.displayName || "Unknown Candidate"],
        ["Candidate Email:", student.email || "Unknown Email"],
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

            payload.push([
              serial++,
              sectionName,
              q.type,
              q.id,
              q.text || '',
              String(correctOption ?? ''),
              String(ans?.value ?? 'VOID'),
              statusString,
              pMarking,
              timeSpentStr
            ]);
          });
        });
      }

      const spreadsheet = await createSpreadsheet(sheetTitle, accessToken);
      await populateSpreadsheet(spreadsheet.id, 'Sheet1!A1', payload, accessToken);
      
      setExportState({ isLoading: false, url: spreadsheet.url, error: null });
    } catch (err: any) {
      console.error(err);
      setExportState({ isLoading: false, url: null, error: err.message || 'Export failed' });
      alert('Google Sheets export failed: ' + (err.message || 'Authorized failed or network error'));
    }
  };

  // AI Generation State
  const [aiTopic, setAiTopic] = useState('');
  const [aiDifficulty, setAiDifficulty] = useState('Medium');
  const [aiQuestionCount, setAiQuestionCount] = useState(10);
  const [aiIsGenerating, setAiIsGenerating] = useState(false);
  const [aiMode, setAiMode] = useState<'manual' | 'ai' | 'document'>('manual');
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [focusedInput, setFocusedInput] = useState<{ qId: string, field: string, idx?: number } | null>(null);

  const insertSymbol = (symbol: string) => {
    if (!focusedInput) return;
    const { qId, field, idx } = focusedInput;
    
    setSectionsData(prev => {
      const section = prev[activeCreationSection];
      const isMcq = section.mcqs.some(q => q.id === qId);
      const type = isMcq ? 'mcqs' : 'numericals';
      
      return {
        ...prev,
        [activeCreationSection]: {
          ...prev[activeCreationSection],
          [type]: prev[activeCreationSection][type].map((q: any) => {
            if (q.id === qId) {
              if (field === 'text') {
                return { ...q, text: q.text + symbol };
              }
              if (field === 'option' && idx !== undefined) {
                const newOptions = [...q.options];
                newOptions[idx] = newOptions[idx] + symbol;
                return { ...q, options: newOptions };
              }
            }
            return q;
          })
        }
      };
    });
  };

  const handeAiGenerate = async () => {
    if (!aiTopic) return alert("Please enter a topic");
    setAiIsGenerating(true);
    try {
      const resp = await fetch('/api/ai/generate-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: aiTopic, difficulty: aiDifficulty, questionCount: aiQuestionCount })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      setExamTitle(data.title);
      setExamDuration(data.duration.toString());
      
      // Replace "sqrt" with "√" in AI-generated questions
      const processedSections = JSON.parse(JSON.stringify(data.sections));
      (Object.entries(processedSections) as [string, any][]).forEach(([key, section]: [string, any]) => {
        const replaceSqrt = (text: string) => text ? text.replace(/sqrt\(/ig, '√(').replace(/sqrt/ig, '√') : text;

        section.mcqs.forEach((q: any) => {
          q.text = replaceSqrt(q.text);
          if (q.options) q.options = q.options.map((opt: string) => replaceSqrt(opt));
        });
        section.numericals.forEach((q: any) => {
          q.text = replaceSqrt(q.text);
        });
      });

      setSectionsData(processedSections);
      setAiMode('manual');
      alert("AI Exam Structure Generated! You can now review and edit the questions.");
    } catch (err: any) {
      alert("AI Generation Error: " + err.message);
    } finally {
      setAiIsGenerating(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      setAiIsGenerating(true);
      try {
        const resp = await fetch('/api/ai/analyze-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: base64, mimeType: file.type })
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        setAnalysisResult(data.analysis);
        setExamTitle(prev => prev || data.exam.title);
        setExamDuration(prev => prev !== '180' ? prev : data.exam.duration.toString());
        setSectionsData(prev => {
          const newSections = { ...prev };
          const incomingSections = data.exam.sections || {};
          Object.keys(incomingSections).forEach(s => {
             const lowerS = s.toLowerCase();
             let sectionName: keyof typeof newSections | undefined;
             
             if (lowerS.includes('math')) sectionName = 'Maths';
             else if (lowerS.includes('phys')) sectionName = 'Physics';
             else if (lowerS.includes('chem')) sectionName = 'Chemistry';
             else {
               sectionName = (Object.keys(newSections) as (keyof typeof newSections)[]).find(
                 key => (key as string).toLowerCase() === lowerS
               );
             }
             if (sectionName) {
               const existing = newSections[sectionName] || { mcqs: [], numericals: [] };
               const incoming = incomingSections[s] || { mcqs: [], numericals: [] };
               newSections[sectionName] = {
                 mcqs: [...(existing.mcqs || []), ...(incoming.mcqs || [])],
                 numericals: [...(existing.numericals || []), ...(incoming.numericals || [])]
               };
             }
          });
          return newSections;
        });
        setAiMode('manual');
      } catch (err: any) {
        alert("Document Analysis Error: " + err.message);
      } finally {
        setAiIsGenerating(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const cleanupAiBots = async () => {
    try {
      // Find bots
      const { data: bots, error } = await supabase
        .from('users')
        .select('id')
        .gte('display_name', 'ai bot 1')
        .lte('display_name', 'ai bot 3');

      if (error) throw error;

      for (const bot of bots || []) {
        // Delete submissions
        await supabase.from('submissions').delete().eq('user_id', bot.id);
        // Delete user
        await supabase.from('users').delete().eq('id', bot.id);
      }
      alert('AI Bots and their data cleaned up!');
    } catch (err: any) {
      console.error(err);
      alert('Cleanup Error: ' + err.message);
    }
  };

  useEffect(() => {
    if (isGlobalAdmin && loading === false && !localStorage.getItem('bots_cleaned')) {
        cleanupAiBots();
        localStorage.setItem('bots_cleaned', 'true');
    }
  }, [isGlobalAdmin, loading]);

  const handleUpdatePreparationType = async (uid: string, type: 'JEE' | 'NEET' | 'Both') => {
    try {
      await supabase
        .from('users')
        .update({ preparation_type: type })
        .eq('id', uid);
      setStudents(prev => prev.map(s => s.uid === uid ? { ...s, preparationType: type } : s));
      setAllUsers(prev => prev.map(s => s.uid === uid ? { ...s, preparationType: type } : s));
    } catch (err: any) {
      alert('Failed to update preparation type: ' + err.message);
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    try {
      const { data: { user: newUser }, error: signUpError } = await supabase.auth.signUp({
        email: newStudentEmail,
        password: newStudentPassword,
        options: {
          data: {
            display_name: newStudentName,
            role: newStudentRole,
          }
        }
      });

      if (signUpError) throw signUpError;

      if (newUser) {
        await supabase.from('users').insert({
          id: newUser.id,
          display_name: newStudentName,
          email: newStudentEmail,
          role: newStudentRole,
          preparation_type: newStudentPrepType,
          password: newStudentPassword,
        });
      }

      // Cleanup
      setNewStudentEmail('');
      setNewStudentPassword('');
      setNewStudentName('');
      setNewStudentPrepType('JEE');
      setNewStudentRole('student');
      setShowCreateStudentModal(false);
      alert(`${newStudentRole === 'admin' ? 'Admin' : 'Student'} account created successfully! They can now login with these credentials.`);
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes('already registered')) {
        alert('Creation Error: Individual Neural ID (Email) is already registered in the central system.');
      } else {
        alert('Creation Error: ' + err.message);
      }
    } finally {
      setIsCreatingStudent(false);
    }
  };

  // Section Management State
  const [activeCreationSection, setActiveCreationSection] = useState<'Maths' | 'Physics' | 'Chemistry'>('Maths');
  const [sectionsData, setSectionsData] = useState({
    Maths: { mcqs: [] as any[], numericals: [] as any[] },
    Physics: { mcqs: [] as any[], numericals: [] as any[] },
    Chemistry: { mcqs: [] as any[], numericals: [] as any[] }
  });

  // ONE-TIME RESET: WIPE ALL SUBMISSIONS & DRAFT EXAMS (Manual trigger via URL only now)
  useEffect(() => {
    const wipeData = async () => {
      if (isGlobalAdmin && loading === false && window.location.search.includes('wipe_all=true')) {
        try {
          if (submissions.length > 0) {
            console.log('[SYS] WIPING ALL SUBMISSIONS...');
            for (const sub of submissions) {
              await supabase.from('submissions').delete().eq('id', sub.id);
            }
            alert('SYSTEM_WIPE_COMPLETE: All submissions have been purged.');
            window.history.replaceState({}, '', window.location.pathname);
          }
        } catch (err) {
          console.error("Global wipe protocol failed", err);
        }
      }
    };
    wipeData();
  }, [isGlobalAdmin, loading]); // Reduced dependencies to prevent excessive runs

  const fetchUsers = React.useCallback(async () => {
    try {
      const { data, error } = await supabase.from('users').select('*');
      if (error) throw error;
      const usersList = (data || []).map(d => mapUserRow(d as UserRow));
      setAllUsers(usersList);
      setStudents(usersList.filter(u => u.role === 'student'));
      setAdmins(usersList.filter(u => u.role === 'staff' || u.role === 'admin'));
    } catch (err) {
      console.error('AdminDashboard: Users fetch failure', err);
      try { handleFirestoreError(err, OperationType.LIST, 'users'); } catch (e) {}
    }
  }, []);

  const fetchSubmissions = React.useCallback(async () => {
    try {
      const { data, error } = await supabase.from('submissions').select('*');
      if (error) throw error;
      setSubmissions((data || []).map(d => mapSubmissionRow(d as SubmissionRow)));
    } catch (err) {
      console.error('AdminDashboard: Submissions fetch failure', err);
      try { handleFirestoreError(err, OperationType.LIST, 'submissions'); } catch (e) {}
    }
  }, []);

  useEffect(() => {
    if (!user || !profile) return; // Wait for profile to be loaded

    let examsReady = false;
    let studentsReady = false;
    let subsReady = false;

    const checkReady = () => {
      if (examsReady && studentsReady && subsReady) {
        setLoading(false);
      }
    };

    fetchUsers().then(() => {
      studentsReady = true;
      checkReady();
    });

    fetchSubmissions().then(() => {
      subsReady = true;
      checkReady();
    });

    // Fetch exams
    const fetchExams = async () => {
      const { data, error } = await supabase.from('exams').select('*').order('created_at', { ascending: false });
      if (!error && data) {
        setExams(data.map(d => mapExamRow(d as ExamRow)));
      }
      examsReady = true;
      checkReady();
    };
    fetchExams();

    // Poll for updates (replacing onSnapshot)
    const pollInterval = setInterval(async () => {
      const { data: examData } = await supabase.from('exams').select('*').order('created_at', { ascending: false });
      if (examData) setExams(examData.map(d => mapExamRow(d as ExamRow)));

      const { data: subData } = await supabase.from('submissions').select('*');
      if (subData) setSubmissions(subData.map(d => mapSubmissionRow(d as SubmissionRow)));
    }, 15000);

    // Fallback timer if snapshots are taking way too long
    const timeout = setTimeout(() => {
      setLoading(false);
    }, 8000);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [user, profile, fetchUsers, fetchSubmissions]);

  // System owner's auto-purge protocol for legacy users
  const runAutoPurge = async () => {
    if (!isGlobalAdmin) return;

    if (!confirm("Run system hygiene check? This will purge role-less ghosts and specific target entries.")) return;

    console.log("[SYS] Running manual hygiene check...");

    // 1. Purge Ghost Profiles (Role-less)
    const roleless = allUsers.filter(u => !u.role);
    if (roleless.length > 0) {
      console.log(`[SYS] Found ${roleless.length} role-less ghosts.`);
      for (const u of roleless) {
        await supabase.from('users').delete().eq('id', u.uid);
      }
    }

    // 2. Purge specific requested names (if any)
    const targetPurgeNames = ['jj', 'sat', 'abinaya', 's.sivabalan', 'bhuvaneshwar r', 'ashwin s', 'je45'];
    const targetPurgeUsers = allUsers.filter(u =>
      u.displayName && targetPurgeNames.some(name =>
        u.displayName?.toLowerCase().includes(name.toLowerCase()) ||
        u.email?.toLowerCase().includes(name.toLowerCase())
      )
    );
    if (targetPurgeUsers.length > 0) {
      console.log(`[SYS] Found ${targetPurgeUsers.length} target users for purge.`);
      for (const u of targetPurgeUsers) {
        await handleDeleteUser(u.uid, true);
      }
    }
    alert("Hygiene check complete.");
  };

  // REMOVED: Auto-running hygiene on every mount/loading state change
  // This was consuming excessive quota.

  const addQuestion = (type: 'mcq' | 'numerical') => {
    const section = sectionsData[activeCreationSection];
    const id = `${activeCreationSection[0]}${type === 'mcq' ? 'M' : 'N'}_${Date.now()}`;
    const newQ = {
      id,
      type,
      text: '',
      imageUrl: '',
      options: type === 'mcq' ? ['', '', '', ''] : undefined,
      optionImages: type === 'mcq' ? ['', '', '', ''] : undefined,
      correctAnswer: type === 'mcq' ? 'A' : 0
    };

    setSectionsData(prev => ({
      ...prev,
      [activeCreationSection]: {
        ...prev[activeCreationSection],
        [type === 'mcq' ? 'mcqs' : 'numericals']: [...prev[activeCreationSection][type === 'mcq' ? 'mcqs' : 'numericals'], newQ]
      }
    }));
  };

  const updateQuestion = (qId: string, field: string, value: any) => {
    setSectionsData(prev => {
      const section = prev[activeCreationSection];
      const isMcq = section.mcqs.some(q => q.id === qId);
      const type = isMcq ? 'mcqs' : 'numericals';
      
      return {
        ...prev,
        [activeCreationSection]: {
          ...prev[activeCreationSection],
          [type]: prev[activeCreationSection][type].map((q: any) => 
            q.id === qId ? { ...q, [field]: value } : q
          )
        }
      };
    });
  };

  const removeQuestion = (qId: string) => {
    setSectionsData(prev => {
      const section = prev[activeCreationSection];
      const isMcq = section.mcqs.some(q => q.id === qId);
      const type = isMcq ? 'mcqs' : 'numericals';
      
      return {
        ...prev,
        [activeCreationSection]: {
          ...prev[activeCreationSection],
          [type]: prev[activeCreationSection][type].filter((q: any) => q.id !== qId)
        }
      };
    });
  };

    const handlePasteImage = (e: React.ClipboardEvent, qId: string, type: 'question' | 'option', optionIdx?: number) => {
    const items = e.clipboardData.items;
    
    // Allow text pasting (for LaTeX)
    if (e.clipboardData.getData('text/plain')) {
      return;
    }

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = async (event) => {
            let base64 = event.target?.result as string;
            
            // Compressing image to prevent 1MB Firestore document limit breach
            try {
              base64 = await compressImage(base64, 1024, 0.5); // 1024px max, 0.5 quality (balanced)
            } catch (err) {
              console.error("IMAGE_COMPRESSION_FAILURE", err);
            }

            if (type === 'question') {
              setSectionsData(prev => {
                const section = prev[activeCreationSection];
                const isMcq = section.mcqs.some(q => q.id === qId);
                const listName = isMcq ? 'mcqs' : 'numericals';
                
                return {
                  ...prev,
                  [activeCreationSection]: {
                    ...prev[activeCreationSection],
                    [listName]: prev[activeCreationSection][listName].map((q: any) => {
                      if (q.id === qId) {
                        const existingUrls = q.imageUrls || (q.imageUrl ? [q.imageUrl] : []);
                        const newUrls = [...existingUrls, base64];
                        return { 
                          ...q, 
                          imageUrls: newUrls,
                          imageUrl: newUrls[0] || '' // Sync primary for back-compat
                        };
                      }
                      return q;
                    })
                  }
                };
              });
            } else if (type === 'option' && optionIdx !== undefined) {
              setSectionsData(prev => {
                const section = prev[activeCreationSection];
                const isMcq = section.mcqs.some(q => q.id === qId);
                const listName = isMcq ? 'mcqs' : 'numericals';
                
                return {
                  ...prev,
                  [activeCreationSection]: {
                    ...prev[activeCreationSection],
                    [listName]: prev[activeCreationSection][listName].map((q: any) => {
                      if (q.id === qId) {
                        const newOptionImages = [...(q.optionImages || ['', '', '', ''])];
                        newOptionImages[optionIdx] = base64;
                        return { ...q, optionImages: newOptionImages };
                      }
                      return q;
                    })
                  }
                };
              });
            }
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const removeQuestionImage = (qId: string, type: 'question' | 'option', optionIdx?: number, imageIdx?: number) => {
    if (type === 'question') {
      setSectionsData(prev => {
        const section = prev[activeCreationSection];
        const isMcq = section.mcqs.some(q => q.id === qId);
        const listName = isMcq ? 'mcqs' : 'numericals';
        
        return {
          ...prev,
          [activeCreationSection]: {
            ...prev[activeCreationSection],
            [listName]: prev[activeCreationSection][listName].map((q: any) => {
              if (q.id === qId) {
                let newUrls = q.imageUrls || (q.imageUrl ? [q.imageUrl] : []);
                if (imageIdx !== undefined) {
                  newUrls = newUrls.filter((_: any, idx: number) => idx !== imageIdx);
                } else {
                  newUrls = [];
                }
                return {
                  ...q,
                  imageUrls: newUrls,
                  imageUrl: newUrls[0] || ''
                };
              }
              return q;
            })
          }
        };
      });
    } else if (type === 'option' && optionIdx !== undefined) {
      setSectionsData(prev => {
        const section = prev[activeCreationSection];
        const isMcq = section.mcqs.some(q => q.id === qId);
        const listName = isMcq ? 'mcqs' : 'numericals';
        
        return {
          ...prev,
          [activeCreationSection]: {
            ...prev[activeCreationSection],
            [listName]: prev[activeCreationSection][listName].map((q: any) => {
              if (q.id === qId) {
                const newOptionImages = [...(q.optionImages || ['', '', '', ''])];
                newOptionImages[optionIdx] = '';
                return { ...q, optionImages: newOptionImages };
              }
              return q;
            })
          }
        };
      });
    }
  };

  const compressAllExamImages = async () => {
    console.log("Starting bulk compression...");
    const newSections = JSON.parse(JSON.stringify(sectionsData));
    let compressedCount = 0;
    
    for (const sectionName of ['Maths', 'Physics', 'Chemistry'] as const) {
      const section = newSections[sectionName];
      
      const processQuestion = async (q: any) => {
        if (q.imageUrl && q.imageUrl.startsWith('data:image') && q.imageUrl.length > 50000) {
          try {
            q.imageUrl = await compressImage(q.imageUrl, 800, 0.4);
            compressedCount++;
          } catch(e) { console.error("Q_IMG_FAIL", e); }
        }
        if (q.imageUrls && Array.isArray(q.imageUrls)) {
          for (let i = 0; i < q.imageUrls.length; i++) {
            if (q.imageUrls[i] && q.imageUrls[i].startsWith('data:image') && q.imageUrls[i].length > 50000) {
              try {
                q.imageUrls[i] = await compressImage(q.imageUrls[i], 800, 0.4);
                compressedCount++;
              } catch(e) { console.error("Q_IMGURL_FAIL", e); }
            }
          }
          if (q.imageUrls[0]) {
            q.imageUrl = q.imageUrls[0];
          }
        }
        if (q.optionImages) {
          for (let i = 0; i < q.optionImages.length; i++) {
            if (q.optionImages[i] && q.optionImages[i].startsWith('data:image') && q.optionImages[i].length > 50000) {
              try {
                q.optionImages[i] = await compressImage(q.optionImages[i], 400, 0.4);
                compressedCount++;
              } catch(e) { console.error("OPT_IMG_FAIL", e); }
            }
          }
        }
      };

      await Promise.all([
        ...section.mcqs.map(processQuestion),
        ...section.numericals.map(processQuestion)
      ]);
    }
    
    if (compressedCount > 0) {
      setSectionsData(newSections);
      alert(`Optimization complete: ${compressedCount} images were compressed. Try saving again.`);
    } else {
      alert("No oversized images found to compress.");
    }
  };

  const saveExam = async () => {
    try {
      if (!examTitle) return alert('Enter exam title');
      
      const answerKey: Record<string, string | number> = {};
      const finalSections: any = {};

      (Object.entries(sectionsData) as [keyof typeof sectionsData, typeof sectionsData['Maths']][]).forEach(([name, data]) => {
        finalSections[name] = {
          name,
          mcqs: data.mcqs.map(q => {
            answerKey[q.id] = q.correctAnswer;
            return { 
              id: q.id, 
              type: q.type, 
              text: q.text, 
              imageUrl: q.imageUrl || '',
              imageUrls: q.imageUrls || (q.imageUrl ? [q.imageUrl] : []),
              options: q.options,
              optionImages: q.optionImages || []
            };
          }),
          numericals: data.numericals.map(q => {
            answerKey[q.id] = q.correctAnswer;
            return { 
              id: q.id, 
              type: q.type, 
              text: q.text,
              imageUrl: q.imageUrl || '',
              imageUrls: q.imageUrls || (q.imageUrl ? [q.imageUrl] : [])
            };
          })
        };
      });

      const examData = {
        title: examTitle,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
        duration: parseInt(examDuration) || 180,
        sections: finalSections,
        answer_key: answerKey,
        preparation_type: preparationTypeExam,
      };

      // Size validation to prevent large payloads
      const estimatedSize = new TextEncoder().encode(JSON.stringify(examData)).length;
      if (estimatedSize > 1040000) {
        if (confirm(`SYSTEM_LIMIT_REACHED: This exam (approx. ${Math.round(estimatedSize/1024)}KB) exceeds the 1MB database limit. Would you like to attempt BULK COMPRESSION of all images to fix this?`)) {
          await compressAllExamImages();
          return;
        }
        return alert(`Saving blocked. Please remove some images or use smaller screenshots.`);
      }

      if (editingExamId) {
        await supabase.from('exams').update(examData).eq('id', editingExamId);

        // Re-calculate scores for all completed submissions for this exam
        const originalExam = exams.find(e => e.id === editingExamId);
        const examObj = { ...originalExam, ...examData, id: editingExamId } as Exam;
        const examSubs = submissions.filter(s => s.examId === editingExamId && s.status === 'completed');

        if (examSubs.length > 0) {
          console.log(`[SYS] Re-scoring ${examSubs.length} submissions for exam: ${editingExamId}`);
          for (const sub of examSubs) {
            const { score, correct, incorrect, skipped } = calculateSubmissionScore(examObj, sub);
            await supabase.from('submissions').update({
              score,
              correct_count: correct,
              incorrect_count: incorrect,
              skipped_count: skipped,
              updated_at: new Date().toISOString()
            }).eq('id', sub.id);
          }
          alert(`EXAM_UPDATED: ${examSubs.length} submissions have been re-scored based on the new answer key.`);
        }
      } else {
        const creatorId = user?.uid || profile?.uid;
        if (!creatorId) return alert('Authentication node not ready. Please refresh the page and try again.');

        await supabase.from('exams').insert({
          ...examData,
          created_by: creatorId,
        });
      }

      setShowCreateModal(false);
      resetForm();
    } catch (err) {
      console.error(err);
      alert('Error saving exam');
    }
  };

  const resetForm = () => {
    setSectionsData({
      Maths: { mcqs: [], numericals: [] },
      Physics: { mcqs: [], numericals: [] },
      Chemistry: { mcqs: [], numericals: [] }
    });
    setExamTitle('');
    setExamDuration('180');
    setEditingExamId(null);
    setStartTime(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setEndTime(format(addHours(new Date(), 24), "yyyy-MM-dd'T'HH:mm"));
  };

  const handleDuplicateExam = async (examToDuplicate: Exam) => {
    try {
      const creatorId = user?.uid || profile?.uid;
      if (!creatorId) return alert('Authentication node not ready. Please refresh the page and try again.');

      await supabase.from('exams').insert({
        title: `${examToDuplicate.title} (Copy)`,
        start_time: examToDuplicate.startTime?.toDate?.()?.toISOString() || new Date().toISOString(),
        end_time: examToDuplicate.endTime?.toDate?.()?.toISOString() || new Date().toISOString(),
        duration: examToDuplicate.duration,
        sections: examToDuplicate.sections,
        answer_key: examToDuplicate.answerKey,
        created_by: creatorId,
        submission_count: 0,
        preparation_type: examToDuplicate.preparationType,
      });
      alert('Exam duplicated successfully!');
    } catch (err) {
      console.error(err);
      alert('Error duplicating exam');
    }
  };

  const handleEditExam = (exam: Exam) => {
    setEditingExamId(exam.id);
    setExamTitle(exam.title);
    setExamDuration(exam.duration.toString());
    const startDate = exam.startTime?.toDate?.() || new Date();
    const endDate = exam.endTime?.toDate?.() || new Date();
    setStartTime(format(startDate, "yyyy-MM-dd'T'HH:mm"));
    setEndTime(format(endDate, "yyyy-MM-dd'T'HH:mm"));

    const newSectionsData = {
      Maths: { mcqs: [] as any[], numericals: [] as any[] },
      Physics: { mcqs: [] as any[], numericals: [] as any[] },
      Chemistry: { mcqs: [] as any[], numericals: [] as any[] }
    };

    (['Maths', 'Physics', 'Chemistry'] as const).forEach(s => {
      const section = exam.sections?.[s];
      if (section) {
        newSectionsData[s].mcqs = section.mcqs.map(q => ({
          ...q,
          imageUrls: q.imageUrls || (q.imageUrl ? [q.imageUrl] : []),
          correctAnswer: exam.answerKey[q.id]
        }));
        newSectionsData[s].numericals = section.numericals.map(q => ({
          ...q,
          imageUrls: q.imageUrls || (q.imageUrl ? [q.imageUrl] : []),
          correctAnswer: exam.answerKey[q.id]
        }));
      }
    });

    setSectionsData(newSectionsData);
    setShowCreateModal(true);
  };

  const deleteExam = async (id: string) => {
    if (!id) return;
    try {
      console.log(`Initiating purge for exam: ${id}`);
      await supabase.from('exams').delete().eq('id', id);
      setShowCreateModal(false);
      setDeleteHoldExamId(null);
      setDeleteHoldProgress(0);
      resetForm();
      alert('EXAM_PURGED: Database updated.');
    } catch (err: any) {
      console.error('Exam Purge Failure:', err);
      alert('DELETE_FAILED: ' + err.message);
    }
  };

  // Helper to safely get millis from lastSeen
  const getLastSeenMillis = (lastSeen: any) => {
    if (!lastSeen) return 0;
    if (typeof lastSeen.toMillis === 'function') return lastSeen.toMillis();
    if (typeof lastSeen.toDate === 'function') return lastSeen.toDate().getTime();
    if (lastSeen instanceof Date) return lastSeen.getTime();
    return 0;
  };

  const handleDeleteSubmission = async (sub: Submission) => {
    try {
      await supabase.from('submissions').delete().eq('id', sub.id);
      setSubmissions(prev => prev.filter(s => s.id !== sub.id));
      setReviewSubmission(null);
      await fetchSubmissions();
      alert('DELETE_SUCCESS: Submission has been permanently removed.');
    } catch (err: any) {
      console.error(err);
      alert('DELETE_FAILED: ' + err.message);
    }
  };

  const [showDeleteModal, setShowDeleteModal] = useState<Submission | null>(null);
  const [deleteInput, setDeleteInput] = useState('');

  const executeUserPurge = async (userId: string, isSilent = false) => {
    if (!isSilent && adminDeleteConfirm !== 'DELETE') return;

    setIsPurging(true);
    try {
      // 1. Delete all submissions for this user
      const toDelete = submissions.filter(s => s.userId === userId || s.id.startsWith(userId + '_'));
      for (const s of toDelete) {
        await supabase.from('submissions').delete().eq('id', s.id);
      }

      // 2. Delete the user profile doc
      await supabase.from('users').delete().eq('id', userId);

      setUserToDelete(null);
      setAdminDeleteConfirm('');
      fetchUsers();

      if (!isSilent) {
        alert('PURGE_COMPLETE: Candidate and all associated metadata have been removed.');
      } else {
        console.log(`[SYS_SILENT_PURGE_SUCCESS] ID: ${userId}`);
      }
    } catch (err: any) {
      console.error(err);
      if (!isSilent) {
        alert('PURGE_TERMINATED: ' + err.message);
      }
    } finally {
      setIsPurging(false);
    }
  };

  const handleDeleteUser = async (userId: string, isSilent = false) => {
    if (isSilent) {
      return executeUserPurge(userId, true);
    }
    const student = allUsers.find(u => u.uid === userId);
    if (student) {
      setUserToDelete(student);
    }
  };

  const handleUpdateInsight = async (userId: string, insight: string) => {
    try {
      await supabase.from('users').update({
        performance_insight: insight,
        updated_at: new Date().toISOString()
      }).eq('id', userId);
      alert('Insight updated successfully');
      fetchUsers();
    } catch(err: any) {
      console.error(err);
      alert('Failed to update insight: ' + err.message);
    }
  };

  const handleDragUpdate = (event: any, info: any) => {
    if (!trashRef.current) return;
    const trashRect = trashRef.current.getBoundingClientRect();
    const point = info.point;
    const over = 
      point.x >= trashRect.left && 
      point.x <= trashRect.right && 
      point.y >= trashRect.top && 
      point.y <= trashRect.bottom;
    setIsOverTrash(over);
  };

  const handleDragEnd = (event: any, info: any, examId: string) => {
    setIsDraggingAny(false);
    setIsOverTrash(false);
    if (!trashRef.current) return;

    const trashRect = trashRef.current.getBoundingClientRect();
    const point = info.point;

    const over = 
      point.x >= trashRect.left && 
      point.x <= trashRect.right && 
      point.y >= trashRect.top && 
      point.y <= trashRect.bottom;

    if (over) {
      const exam = exams.find(e => e.id === examId);
      if (exam) {
        setExamToDelete(exam);
      }
    }
  };

  const getRankData = React.useMemo(() => {
    const examSubs = submissions.filter(s => s.status === 'completed' && !s.hidden);
    
    // Group by student to support "double bar graph" for multiple attempts
    const studentGrps: { [userId: string]: { name: string, attempts: { examTitle: string, score: number }[] } } = {};
    
    examSubs.forEach(s => {
      const exam = exams.find(e => e.id === s.examId);
      if (!exam) return;
      const { score } = calculateSubmissionScore(exam, s);
      
        if (!studentGrps[s.userId]) {
          const user = allUsers.find(u => u.uid === s.userId);
          studentGrps[s.userId] = {
            name: user?.role === 'admin' ? 'Admin Testing' : (user?.displayName || 'Unknown Candidate'),
            attempts: []
          };
        }
      studentGrps[s.userId].attempts.push({ examTitle: exam.title, score });
    });

    const result = Object.values(studentGrps).map(grp => {
      // Sort attempts by score descending
      const sortedAttempts = grp.attempts.sort((a, b) => b.score - a.score);
      return {
        name: grp.name,
        score: sortedAttempts[0]?.score || 0,
        exam1: sortedAttempts[0]?.examTitle || 'N/A',
        score2: sortedAttempts[1]?.score || 0,
        exam2: sortedAttempts[1]?.examTitle || 'N/A',
      };
    });

    return result
      .sort((a, b) => b.score - a.score)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, [submissions, exams, students]);

  useEffect(() => {
    if (holdProgress >= 100 && previewHoldExam) {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
      const eId = previewHoldExam;
      setPreviewHoldExam(null);
      setHoldProgress(0);
      onStartTest(eId);
    }
  }, [holdProgress, previewHoldExam, onStartTest]);

  useEffect(() => {
    if (deleteHoldProgress >= 100 && deleteHoldExamId) {
      if (deleteHoldIntervalRef.current) clearInterval(deleteHoldIntervalRef.current);
      deleteExam(deleteHoldExamId);
    }
  }, [deleteHoldProgress, deleteHoldExamId]);

  useEffect(() => {
    examDraftRef.current = {
      title: examTitle,
      duration: examDuration,
      startTime,
      endTime,
      sections: sectionsData
    };
  }, [examTitle, examDuration, startTime, endTime, sectionsData]);

  useEffect(() => {
    if (!editingExamId) return;

    const interval = setInterval(async () => {
      const { title, duration, startTime, endTime, sections } = examDraftRef.current;
      try {
        await supabase.from('exams').update({
          title,
          duration: parseInt(duration),
          start_time: new Date(startTime).toISOString(),
          end_time: new Date(endTime).toISOString(),
          sections: sections,
          updated_at: new Date().toISOString()
        }).eq('id', editingExamId);
        console.log(`[SYS] Auto-saved draft for exam: ${editingExamId}`);
      } catch (err) {
        console.error('[SYS] Auto-save failed', err);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [editingExamId]);


  if (loading) return <div className="min-h-screen flex items-center justify-center bg-neutral-900"><Loader2 className="animate-spin text-white" /></div>;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row overflow-hidden">
      {/* Mobile Top Header */}
      <div className="md:hidden h-16 bg-slate-900 px-6 flex items-center justify-between shadow-xl z-[40]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-black text-white text-xs">JC</div>
          <span className="font-black text-xs tracking-tight uppercase text-white">JEE Mock</span>
        </div>
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 text-slate-400 hover:text-white transition-colors"
        >
          <Menu size={24} />
        </button>
      </div>


      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[45] md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 w-64 bg-slate-900 text-white flex flex-col shrink-0 z-[50] transition-transform duration-300 md:relative md:translate-x-0 md:z-0",
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 flex items-center gap-3 border-b border-slate-800">
          <div className="w-10 h-10 bg-blue-600 rounded flex items-center justify-center font-black text-white shadow-lg shadow-blue-500/20">
            JC
          </div>
          <span className="font-black text-lg tracking-tight uppercase">JEE - Mock Assessment</span>
        </div>

        <nav className="flex-1 py-8 px-4 space-y-2">
          <button 
            onClick={() => { setActiveTab('exams'); setMobileMenuOpen(false); }}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all",
              activeTab === 'exams' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30" : "text-slate-400 hover:bg-slate-800 hover:text-white"
            )}
          >
            <FileText size={20} /> Dashboard
          </button>
          <button 
            onClick={() => { setActiveTab('students'); setMobileMenuOpen(false); }}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all",
              activeTab === 'students' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30" : "text-slate-400 hover:bg-slate-800 hover:text-white"
            )}
          >
            <Users size={20} /> Student Directory
          </button>
          {isSuperAdmin && (
            <button 
              onClick={() => { setActiveTab('admins'); setMobileMenuOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all",
                activeTab === 'admins' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30" : "text-slate-400 hover:bg-slate-800 hover:text-white"
              )}
            >
              <UserIcon size={20} /> Admin Directory
            </button>
          )}
          <button 
            onClick={() => { setActiveTab('stats'); setMobileMenuOpen(false); }}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all",
              activeTab === 'stats' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30" : "text-slate-400 hover:bg-slate-800 hover:text-white"
            )}
          >
            <BarChart2 size={20} /> Performance Ranks
          </button>
          <button 
            onClick={() => { setActiveTab('performance'); setMobileMenuOpen(false); }}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all",
              activeTab === 'performance' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30" : "text-slate-400 hover:bg-slate-800 hover:text-white"
            )}
          >
            <TrendingUp size={20} /> Performance Insight
          </button>
          <button 
            onClick={() => { setActiveTab('submissions'); setMobileMenuOpen(false); }}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all",
              activeTab === 'submissions' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30" : "text-slate-400 hover:bg-slate-800 hover:text-white"
            )}
          >
            <History size={20} /> Global History
          </button>
          <button 
            onClick={() => { setActiveTab('reviews'); setMobileMenuOpen(false); }}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all",
              activeTab === 'reviews' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30" : "text-slate-400 hover:bg-slate-800 hover:text-white"
            )}
          >
            <Eye size={20} /> Reviews & Audits
          </button>
          <button 
            onClick={() => { setActiveTab('monitor'); setMobileMenuOpen(false); }}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all",
              activeTab === 'monitor' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30" : "text-slate-400 hover:bg-slate-800 hover:text-white"
            )}
          >
            <Activity size={20} /> Live Monitor
          </button>
        </nav>

        <div className="p-6 border-t border-slate-800">
          <div className="flex items-center gap-3 mb-6 bg-slate-800/50 p-3 rounded-xl">
            <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center border border-slate-600 shrink-0">
              <UserIcon size={20} className="text-slate-300" />
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold truncate text-slate-200">{profile?.displayName}</p>
              <p className={cn(
                "text-[10px] uppercase font-black tracking-widest",
                isSuperAdmin ? "text-amber-400" : (profile?.role === 'staff' ? "text-blue-400" : "text-green-400")
              )}>
                {isSuperAdmin ? 'System Owner' : (profile?.role === 'staff' ? 'Administrator' : 'Student Access')}
              </p>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-800 text-xs font-black uppercase tracking-widest text-slate-400 hover:bg-red-950 hover:text-red-400 transition-all"
          >
            <LogOut size={14} /> Exit System
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="h-20 bg-white border-b border-slate-200 px-6 md:px-12 flex items-center justify-between sticky top-0 z-10 shadow-sm">
          <div>
            <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">
              {activeTab === 'exams' && 'Mock Schedule'}
              {activeTab === 'students' && 'Student Base'}
              {activeTab === 'admins' && 'Administrative Staff'}
              {activeTab === 'stats' && 'Global Analytics'}
              {activeTab === 'monitor' && 'Candidate Surveillance'}
              {activeTab === 'submissions' && 'Global History'}
            </h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Standard Marking +4/-1 Active
            </p>
          </div>
          <div className="flex items-center gap-4">
             {isSuperAdmin && (
                <button 
                  onClick={() => setShowSettings(true)}
                  className="p-3 bg-slate-100 text-slate-500 hover:text-blue-600 hover:bg-white hover:shadow-lg rounded-xl transition-all active:scale-95 border border-transparent hover:border-blue-100"
                  title="System Settings"
                >
                  <Settings size={20} />
                </button>
             )}
             <div className="bg-slate-100 px-4 py-2 rounded-lg text-xs font-bold text-slate-500 uppercase tracking-widest">
               verified✔️
             </div>
          </div>
        </header>

        {showSettings && (
          <SettingsModal 
            user={auth.currentUser} 
            profile={profile} 
            onClose={() => setShowSettings(false)} 
          />
        )}

        <div className="p-6 md:p-12">
        <AnimatePresence mode="wait">
            {activeTab === 'exams' && (
              <motion.div 
                key="exams"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-6xl"
              >
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 mb-12">
                  <div>
                    <h2 className="text-2xl md:text-4xl font-black text-slate-900 mb-2">Exam Schedule Management</h2>
                    <p className="text-slate-500 text-sm font-medium italic">Click boxes to edit answer keys or student stats.</p>
                  </div>
                  <div className="flex flex-wrap gap-4 w-full lg:w-auto">
                     <button 
                         onClick={() => setShowCreateModal(true)}

                         className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl font-black shadow-xl shadow-blue-500/30 flex items-center gap-3 transition-transform hover:-translate-y-1 order-2"
                       >
                        <Plus size={20} strokeWidth={3} /> CREATE NEW EXAM
                      </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {exams.map(e => (
                    <motion.div 
                      key={e.id}
                      layout
                      drag
                      dragSnapToOrigin
                      onDragStart={() => setIsDraggingAny(true)}
                      onDrag={handleDragUpdate}
                      onDragEnd={(event, info) => handleDragEnd(event, info, e.id)}
                      whileDrag={{ scale: 1.05, zIndex: 100, rotate: 2 }}
                      className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm hover:border-blue-400 transition-all group cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex justify-between items-start mb-6">
                        <div className="flex gap-2">
                           {canModifyExams && (
                             <button 
                               onPointerDown={(event) => event.stopPropagation()}
                               onClick={(event) => {
                                 event.stopPropagation();
                                 setExamToDelete(e);
                                }}
                                className="p-2 bg-red-50 text-red-400 hover:text-white hover:bg-red-600 rounded-lg transition-all z-10"
                                title="Purge Exam"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                            {canModifyExams && (
                              <button 
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleEditExam(e);
                                }}
                                className="p-2 bg-slate-100 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all z-10"
                                title="Edit Exam"
                              >
                                <Settings size={14} />
                              </button>
                            )}
                            <button 
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                setDocExportState({
                                  exam: e
                                });
                                setCreatedDocUrl(null);
                              }}
                              className="p-2 bg-indigo-50 text-indigo-500 hover:text-white hover:bg-indigo-600 rounded-lg transition-all z-10"
                              title="Export Question Paper to Docs with Answer Key"
                            >
                              <Printer size={14} />
                            </button>
                            <button 
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDuplicateExam(e);
                              }}
                              className="p-2 bg-yellow-50 text-yellow-500 hover:text-white hover:bg-yellow-600 rounded-lg transition-all z-10"
                              title="Duplicate Exam"
                            >
                              <Copy size={14} />
                            </button>
                        </div>
                        <span className="px-2.5 py-1 bg-green-100 text-green-700 text-[10px] font-black rounded uppercase tracking-wider">
                          {submissions.filter(s => s.examId === e.id).length > 0 ? 'Live' : 'Scheduled'}
                        </span>
                      </div>
                      
                      <h3 className="text-xl font-black text-slate-900 mb-2 uppercase tracking-tight">{e.title}</h3>
                      <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                        75 Questions (20+5 Pattern) | {e.duration / 60}h | Fullscreen Secure Mode.
                      </p>

                      <div className="grid grid-cols-2 gap-3 mb-6">
                         <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                           <Calendar size={10} className="inline mr-1" /> {format(e.startTime.toDate(), 'dd MMM')}
                         </div>
                         <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                           <Clock size={10} className="inline mr-1" /> {format(e.startTime.toDate(), 'p')}
                         </div>
                      </div>

                      <div className="mt-auto pt-6 border-t border-slate-100 flex flex-col gap-4">
                        <div className="flex justify-between text-[11px] font-black uppercase tracking-widest">
                          <span className="text-blue-600 bg-blue-50 px-3 py-1 rounded-full text-[10px]">
                              {new Set(submissions.filter(s => s.examId === e.id && !s.hidden && allUsers.some(u => u.uid === s.userId)).map(s => s.userId)).size} Students
                            </span>
                          <span className="text-slate-400 bg-amber-50 px-3 py-1 rounded-full text-[10px] text-amber-700">Top Score: {
                            Math.max(...submissions.filter(s => s.examId === e.id && !s.hidden && allUsers.some(u => u.uid === s.userId)).map(s => {
                              const { score } = calculateSubmissionScore(e, s);
                              return score;
                            }), 0)
                          }</span>
                        </div>
                        <div className="flex gap-2 w-full">
                          {(profile?.role === 'student' || isSuperAdmin || profile?.email?.toLowerCase() === 'thedivine.la@gmail.com') && (
                            <button 
                              onClick={() => onStartTest(e.id)}
                              className="flex-1 py-3 bg-green-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-green-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-500/20"
                            >
                               <FileText size={12} /> Take Sample
                            </button>
                          )}
                          <button 
                            onClick={() => { setExamFilter(e.id); setActiveTab('submissions'); }}
                            className="flex-1 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
                          >
                             <Eye size={12} /> Results
                          </button>
                          <button 
                            onClick={() => setAnalyzingExam(e)}
                            className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                          >
                             <BarChart2 size={12} /> Analytics
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {exams.length === 0 && (
                    <div className="col-span-3 py-20 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
                      <FileText size={48} className="mx-auto text-slate-300 mb-4" />
                      <p className="text-slate-500 font-bold uppercase tracking-widest">No exams scheduled yet.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'students' && (
              <motion.div 
                key="students"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                  <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 mb-12">
                    <div>
                      <h2 className="text-2xl md:text-4xl font-black text-slate-900 mb-2">Student Base</h2>
                      <p className="text-slate-500 text-sm font-medium italic">Manage individual account performance and session status. (Snapshot disabled to save quota)</p>
                    </div>
                    <div className="flex flex-col items-end gap-4 w-full lg:w-auto">
                      <div className="relative w-full lg:w-64">
                         <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
                         <input 
                           type="text" 
                           placeholder="Search students..." 
                           value={searchTerm}
                           onChange={(e) => setSearchTerm(e.target.value)}
                           className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                         />
                      </div>
                      <div className="flex flex-wrap gap-4 w-full lg:w-auto">
                        <button 
                          onClick={() => fetchUsers()}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-6 py-4 rounded-xl font-black flex items-center gap-2 transition-all"
                        >
                          <Activity size={18} /> REFRESH
                        </button>
                        {isSuperAdmin && (
                          <button 
                            onClick={() => setShowCreateStudentModal(true)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl font-black shadow-xl shadow-blue-500/30 flex items-center gap-3 transition-transform hover:-translate-y-1"
                          >
                            <Plus size={20} strokeWidth={3} /> CREATE USER
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Actions</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Primary Identity</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact Info</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Root Secret</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Submissions</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Activity</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Preparation</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Sync</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students
                        .filter(student => 
                           student.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           student.email?.toLowerCase().includes(searchTerm.toLowerCase())
                        )
                        .map(student => (
                        <tr key={student.uid} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                          <td className="px-8 py-5">
                            <div className="flex gap-2">
                              {canDeleteUsers && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteUser(student.uid);
                                  }}
                                  className="p-3 bg-red-50 text-red-500 hover:text-white hover:bg-red-600 rounded-xl transition-all shadow-sm active:scale-95"
                                  title="Permanently Delete Account"
                                >
                                  <Trash2 size={18} />
                                </button>
                              )}
                              <button 
                                onClick={() => {
                                  const userSubs = submissions.filter(s => s.userId === student.uid && s.status === 'completed');
                                  if (userSubs.length === 0) {
                                    alert('No completed submissions found for this user.');
                                    return;
                                  }
                                  setReportSelectStudent(student);
                                }}
                                className="text-blue-600 font-black text-xs uppercase tracking-widest hover:underline px-4 py-2 bg-blue-50 rounded-lg transition-all active:scale-95"
                              >
                                Analytic Report
                              </button>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center font-black text-sm uppercase shadow-sm">
                                {student.displayName[0]}
                              </div>
                              <span className="font-black text-slate-800 tracking-tight">{student.displayName}</span>
                            </div>
                          </td>
                          <td className="px-8 py-5 text-sm font-medium text-slate-500">{student.email}</td>
                          <td className="px-8 py-5 text-center">
                             <div className="font-mono text-xs bg-slate-900 text-amber-400 px-3 py-1.5 rounded-lg inline-block font-bold">
                                {student.password || '••••••••'}
                             </div>
                          </td>
                          <td className="px-8 py-5 text-center">
                             <div className="font-mono text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg inline-block font-black">
                                {submissions.filter(s => s.userId === student.uid).length}
                             </div>
                          </td>
                          <td className="px-8 py-5">
                             <div className="flex flex-col">
                              <span className={cn("font-black", submissions.filter(s => s.userId === student.uid && s.status === 'completed').length === 0 ? "text-slate-400" : "text-slate-700")}>
                             {(submissions.filter(s => s.userId === student.uid && s.status === 'completed').length)} Submissions
                              </span>
                               <span className="text-[10px] text-slate-400 italic">Last attempt {submissions.filter(s => s.userId === student.uid && s.status === 'completed').length > 0 ? 'Recently' : 'Never'}</span>
                             </div>
                          </td>
                          <td className="px-8 py-5">
                             <select 
                               value={student.preparationType || 'JEE'}
                               onChange={(e) => handleUpdatePreparationType(student.uid, e.target.value as 'JEE' | 'NEET' | 'Both')}
                               className="bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider outline-none"
                             >
                                 <option value="JEE">JEE</option>
                                 <option value="NEET">NEET</option>
                                 <option value="Both">Both</option>
                             </select>
                          </td>
                          <td className="px-8 py-5">
                            <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-[10px] font-black uppercase tracking-wider">Online</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
            
            {activeTab === 'admins' && (
              <motion.div 
                key="admins"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <div className="mb-12 flex justify-between items-end">
                  <div>
                    <h2 className="text-4xl font-black text-slate-900 mb-2">Admin Directory</h2>
                    <p className="text-slate-500 font-medium italic">Manage staff accounts and system permissions.</p>
                  </div>
                  <button 
                    onClick={() => {setNewStudentRole('admin'); setShowCreateStudentModal(true);}}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl font-black shadow-xl shadow-blue-500/30 flex items-center gap-3 transition-transform hover:-translate-y-1"
                  >
                    <Plus size={20} strokeWidth={3} /> CREATE ADMIN
                  </button>
                </div>

                <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Administrator</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Email Address</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {admins.map(admin => (
                        <tr key={admin.uid} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                          <td className="px-8 py-5">
                            {admin.uid !== user?.uid && (isOwner || (isGlobalAdmin && admin.email !== 'admin123@gmail.com')) && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteUser(admin.uid);
                                }}
                                className="p-3 bg-red-50 text-red-500 hover:text-white hover:bg-red-600 rounded-xl transition-all shadow-sm active:scale-95"
                                title="Revoke Admin Access and Purge"
                              >
                                <Trash2 size={18} />
                              </button>
                            )}
                          </td>
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center font-black text-sm uppercase shadow-sm">
                                {admin.displayName[0]}
                              </div>
                              <div>
                                <span className="font-black text-slate-800 tracking-tight">{admin.displayName}</span>
                                {admin.uid === user?.uid && (
                                  <span className="ml-2 px-2 py-0.5 bg-blue-50 text-blue-600 text-[8px] font-black uppercase rounded border border-blue-100">You</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-5 text-sm font-medium text-slate-500">{admin.email}</td>
                          <td className="px-8 py-5 text-center">
                            <span className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-[10px] font-black uppercase tracking-wider">Active</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {activeTab === 'reviews' && (
              <motion.div 
                key="reviews"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <div className="mb-12">
                  <h2 className="text-4xl font-black text-slate-900 mb-2">Experiences & Reviews</h2>
                  <p className="text-slate-500 font-medium italic">Overview of system feedback and functional audit logs.</p>
                </div>
                <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center text-slate-500">
                   No reviews or audit logs available at this time.
                </div>
              </motion.div>
            )}

            {activeTab === 'performance' && (
              <motion.div 
                key="performance"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-6"
              >
                <div className="flex justify-between items-end mb-4">
                  <div>
                    <h2 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em] mb-2">Neural Insight Engine</h2>
                    <h1 className="text-4xl font-black italic tracking-tighter uppercase leading-none">Performance Insights Editor</h1>
                  </div>
                </div>

                <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest text-left">Student</th>
                        <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest">Insight/Feedback</th>
                        <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {students.map(student => (
                        <tr key={student.uid}>
                          <td className="px-6 py-4 font-bold text-slate-800">{student.displayName}</td>
                          <td className="px-6 py-4">
                            <input 
                              type="text"
                              data-uid={student.uid}
                              defaultValue={student.performanceInsight || ''}
                              className="w-full bg-slate-50 border border-slate-200 px-4 py-2 rounded-lg"
                              placeholder="Add insight..."
                            />
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                               onClick={() => {
                                 const input = document.querySelector(`input[data-uid="${student.uid}"]`) as HTMLInputElement;
                                 handleUpdateInsight(student.uid, input?.value || '');
                               }}
                               className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold"
                            >Save</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {activeTab === 'monitor' && (
            <div className="space-y-8">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <h2 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em] mb-2">Network Presence Monitor</h2>
                  <h1 className="text-4xl font-black italic tracking-tighter uppercase leading-none">Online & Offline Status</h1>
                </div>
                <div className="bg-blue-50 px-6 py-3 rounded-2xl border border-blue-100 flex items-center gap-3">
                  <div className="w-2 h-2 bg-blue-600 rounded-full animate-ping" />
                  <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                    {students.filter(s => s.lastSeen && (Date.now() - getLastSeenMillis(s.lastSeen) < 60000)).length} Students Online
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {students
                  .sort((a, b) => {
                    return (getLastSeenMillis(b.lastSeen) || 0) - (getLastSeenMillis(a.lastSeen) || 0);
                  })
                  .map((student) => {
                    const isOnline = student.lastSeen && (Date.now() - getLastSeenMillis(student.lastSeen) < 60000);
                    const activeSub = submissions.find(s => s.userId === student.uid && s.status === 'started');
                    
                    return (
                      <motion.div 
                        key={student.uid}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={cn(
                          "p-5 rounded-2xl border shadow-sm transition-all flex flex-col justify-between bg-white group h-full relative overflow-hidden",
                          isOnline ? "border-green-100 ring-1 ring-green-50 shadow-green-500/5 shadow-md" : "border-slate-100 grayscale-[0.2]"
                        )}
                      >
                        <div className="flex items-start justify-between w-full gap-2">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="relative shrink-0">
                              <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm uppercase",
                                isOnline ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"
                              )}>
                                {student.displayName ? student.displayName[0] : '?'}
                              </div>
                              <div className={cn(
                                "absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white",
                                isOnline ? "bg-green-500 animate-pulse" : "bg-slate-300"
                              )} />
                            </div>
                            
                            <div className="overflow-hidden">
                              <h3 className="text-sm font-black text-slate-800 truncate uppercase tracking-tight leading-tight mb-1" title={student.displayName}>
                                {student.displayName}
                              </h3>
                              <p className="text-[10px] font-semibold text-slate-400 truncate leading-none" title={student.email}>
                                {student.email}
                              </p>
                            </div>
                          </div>

                          {/* Quick Action Button for Admin in Monitor */}
                          {isSuperAdmin && (
                            <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <button
                                onClick={() => {
                                  const userSubs = submissions.filter(s => s.userId === student.uid);
                                  if (userSubs.length === 0) {
                                    alert("No submission records found for this candidate.");
                                    return;
                                  }
                                  // If there's an active sub, or most recent completed sub
                                  const subToReset = userSubs.find(s => s.status === 'started') || 
                                                   userSubs.sort((a,b) => (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0))[0];
                                  
                                  if (subToReset) {
                                    setShowDeleteModal(subToReset);
                                  }
                                }}
                                className="p-2 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-lg transition-all cursor-pointer"
                                title="Reset Current/Last Attempt"
                              >
                                <History size={12} />
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className={cn(
                            "text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full",
                            isOnline ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500"
                          )}>
                            {isOnline ? 'Online Now' : 'Offline'}
                          </span>
                          {activeSub && (
                            <span className="text-[8px] bg-blue-55 text-blue-600 px-2 py-0.5 rounded-full font-black animate-pulse border border-blue-100">
                              Test In Progress
                            </span>
                          )}
                        </div>

                        {/* Last System Interaction indicating detailed exact Date, Day and Time */}
                        <div className="mt-4 pt-3 border-t border-slate-100">
                          <p className="text-[9px] font-black text-slate-450 uppercase tracking-[0.1em] mb-1">Last System Interaction</p>
                          <div className="flex items-center gap-1.5 text-slate-700">
                            <Clock size={11} className="text-slate-400 shrink-0" />
                            <p className="text-[10px] font-bold font-mono tracking-tight text-slate-600 leading-tight">
                              {student.lastSeen ? (
                                format(student.lastSeen.toDate?.() || new Date(getLastSeenMillis(student.lastSeen)), 'EEEE, d MMMM yyyy @ hh:mm:ss a')
                              ) : (
                                <span className="text-slate-400 italic text-[9px] font-medium tracking-tight">Never Interacted</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
              </div>
            </div>
          )}

          {activeTab === 'submissions' && (
              <motion.div 
                 key="submissions"
                 initial={{ opacity: 0, y: 20 }}
                 animate={{ opacity: 1, y: 0 }}
                 exit={{ opacity: 0, y: -20 }}
                 className="space-y-8"
              >
                <div className="flex justify-between items-end mb-8">
                  <div>
                    <h2 className="text-4xl font-black text-slate-900 mb-2">Global History</h2>
                    <p className="text-slate-500 font-medium italic">Complete log of all neural assessment transmissions.</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Filter by Exam:</span>
                    <select 
                      value={examFilter} 
                      onChange={(e) => setExamFilter(e.target.value)}
                      className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs font-black uppercase outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="all">All Sessions</option>
                      {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                    </select>
                  </div>
                </div>

                <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden text-left">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200 text-left">
                        <tr>
                          <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Candidate</th>
                          <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Diagnostic Session</th>
                          <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Attempted</th>
                          <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Correct</th>
                          <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Incorrect</th>
                          <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Score</th>
                          <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Timestamp</th>
                          <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-sans">
                        {submissions
                          .filter(s => s.status === 'completed' && (examFilter === 'all' || s.examId === examFilter))
                          .sort((a,b) => (b.submittedAt?.toMillis() || 0) - (a.submittedAt?.toMillis() || 0))
                          .map(sub => {
                            const foundUser = allUsers.find(u => u.uid === sub.userId);
                            const displayName = foundUser?.role === 'admin' ? 'Admin Testing' : (foundUser?.displayName || 'Unknown Candidate');
                            const exam = exams.find(e => e.id === sub.examId);
                            if (!exam) return null;
                            const res = calculateSubmissionScore(exam, sub);
                            const correct = sub.correctCount ?? res.correct;
                            const incorrect = sub.incorrectCount ?? res.incorrect;
                            const score = sub.score ?? res.score;
                            
                            return (
                              <tr key={sub.id} className="hover:bg-slate-50 transition-colors group text-[11px] font-bold">
                                <td className="px-8 py-6">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center font-black text-[10px] uppercase">
                                      {displayName[0]}
                                    </div>
                                    <div>
                                      <p className="text-sm font-black text-slate-800 tracking-tight leading-none mb-1">{displayName}</p>
                                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{foundUser?.email}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-8 py-6">
                                  <p className="text-sm font-black text-slate-700 italic tracking-tight">{exam.title}</p>
                                </td>
                                <td className="px-8 py-6 text-center text-slate-500">{correct + incorrect}</td>
                                <td className="px-8 py-6 text-center text-green-600">+{correct}</td>
                                <td className="px-8 py-6 text-center text-red-500">-{incorrect}</td>
                                <td className="px-8 py-6 text-center">
                                  <span className="text-lg font-black text-blue-600">{score}</span>
                                </td>
                                <td className="px-8 py-6 text-center">
                                  <p className="text-xs font-bold text-slate-500">{format(sub.submittedAt?.toDate() || new Date(), 'MMM d, HH:mm')}</p>
                                </td>
                                <td className="px-8 py-6 text-right">
                                  <div className="flex justify-end gap-2 shrink-0">
                                    <button
                                      onClick={async () => {
                                        try {
                                          await supabase.from('submissions').update({
                                            hidden: !sub.hidden,
                                            updated_at: new Date().toISOString()
                                          }).eq('id', sub.id);

                                          // Update submission count
                                          const { data: examData } = await supabase
                                            .from('exams')
                                            .select('submission_count')
                                            .eq('id', sub.examId)
                                            .single();

                                          if (examData) {
                                            await supabase.from('exams').update({
                                              submission_count: (examData.submission_count || 0) + (sub.hidden ? 1 : -1)
                                            }).eq('id', sub.examId);
                                          }
                                          fetchSubmissions();
                                        } catch (err) {
                                          console.error("Toggle hide failed", err);
                                          alert("Failed to update status");
                                        }
                                      }}
                                      className={cn(
                                        "px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                                        sub.hidden ? "bg-amber-100 text-amber-600 hover:bg-amber-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                      )}
                                    >
                                      {sub.hidden ? 'Show Rank' : 'Hide Rank'}
                                    </button>
                                    <button 
                                      onClick={() => foundUser && setReviewSubmission({ exam, sub, student: foundUser })}
                                      className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-600 transition-all opacity-0 group-hover:opacity-100"
                                    >
                                      Inspect
                                    </button>
                                    <button 
                                      onClick={() => setShowDeleteModal(sub)}
                                      className="px-3 py-2 bg-red-100 text-red-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                                      title="Delete submission"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}
            {activeTab === 'stats' && (
              <motion.div 
                 key="stats"
                 initial={{ opacity: 0, y: 20 }}
                 animate={{ opacity: 1, y: 0 }}
                 exit={{ opacity: 0, y: -20 }}
                 className="space-y-12"
              >
                <div className="flex justify-between items-end mb-12">
                  <div>
                    <h2 className="text-4xl font-black text-slate-900 mb-2 italic">Performance Analytics</h2>
                    <p className="text-slate-500 font-medium italic tracking-tight">Granular score distribution across all scheduled diagnostic sessions.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="bg-slate-900 text-white px-6 py-4 rounded-2xl flex items-center gap-3">
                      <Trophy className="text-blue-400" size={20} />
                      <div className="text-left">
                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1">Total Submissions</p>
                        <p className="text-xl font-black tracking-tight leading-none">0</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-12">
                   {exams.filter(exam => submissions.some(s => s.examId === exam.id && s.status === 'completed')).map(exam => {
                     const examSubs = submissions
                       .filter(s => s.examId === exam.id && s.status === 'completed' && !s.hidden)
                       .sort((a,b) => (b.score ?? 0) - (a.score ?? 0));
                     
                     const examChartData = examSubs.map((s, idx) => {
                       const user = allUsers.find(u => u.uid === s.userId);
                       return {
                         name: user?.displayName || s.userName || `ID_${idx + 1}`,
                         score: s.score ?? 0,
                         rank: idx + 1
                       };
                     });

                     return (
                       <section key={exam.id} className="bg-white border border-slate-200 rounded-[40px] p-10 shadow-sm group hover:border-blue-400 transition-all">
                         <div className="flex justify-between items-start mb-8">
                           <div>
                             <h3 className="text-2xl font-black text-slate-900 uppercase italic tracking-tight mb-2 group-hover:text-blue-600 transition-colors">{exam.title}</h3>
                             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">{examSubs.length} Active Data Points Captured</p>
                           </div>
                           <div className="text-right">
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Highest Score</p>
                             <p className="text-4xl font-black text-blue-600 tracking-tighter italic">{Math.max(...examSubs.map(s => s.score ?? 0), 0)}</p>
                           </div>
                         </div>

                         <div className="h-[350px] w-full">
                           <ResponsiveContainer width="100%" height="100%">
                             <BarChart data={examChartData}>
                               <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                               <XAxis 
                                 dataKey="name" 
                                 axisLine={false} 
                                 tickLine={false} 
                                 tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }}
                                 hide={examChartData.length > 20}
                               />
                               <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 900, fill: '#94a3b8' }} />
                               <Tooltip 
                                 cursor={{ fill: '#f8fafc', radius: 12 }} 
                                 content={({ active, payload, label }) => {
                                   if (active && payload && payload.length) {
                                     const data = payload[0].payload;
                                     return (
                                       <div className="bg-slate-900/95 backdrop-blur-xl text-white p-6 rounded-3xl shadow-2xl border border-slate-700/50 min-w-[200px]">
                                          <p className="font-black text-[10px] uppercase tracking-widest text-blue-400 mb-3 underline">Rank #{data.rank}</p>
                                          <p className="text-sm font-black uppercase italic mb-4">{label}</p>
                                          <div className="flex items-end justify-between">
                                            <span className="text-3xl font-black text-white italic">{data.score}</span>
                                            <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Aggregate Score</span>
                                          </div>
                                       </div>
                                     );
                                   }
                                   return null;
                                 }}
                               />
                               <Bar dataKey="score" radius={[8, 8, 8, 8]} barSize={32}>
                                 {examChartData.map((entry, index) => (
                                   <Cell key={`cell-${index}`} fill={index === 0 ? '#2563eb' : (index === 1 ? '#3b82f6' : (index === 2 ? '#60a5fa' : '#cbd5e1'))} />
                                 ))}
                               </Bar>
                             </BarChart>
                           </ResponsiveContainer>
                         </div>

                         <div className="mt-8 pt-8 border-t border-slate-100 flex justify-between items-center">
                            <div className="flex gap-10">
                               <div className="flex flex-col">
                                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Average Score</span>
                                  <span className="text-xl font-black text-slate-900 tracking-tighter">
                                    {examSubs.length > 0 ? Math.round(examSubs.reduce((a, b) => a + (b.score || 0), 0) / examSubs.length) : 0}
                                  </span>
                               </div>
                               <div className="flex flex-col">
                                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Participation</span>
                                  <span className="text-xl font-black text-slate-900 tracking-tighter">
                                    {students.length > 0 ? Math.round((examSubs.length / students.length) * 100) : 0}%
                                  </span>
                               </div>
                            </div>
                            <button 
                              onClick={() => { setExamFilter(exam.id); setActiveTab('submissions'); }}
                              className="px-6 py-3 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-600 transition-all flex items-center gap-2"
                            >
                              View Individual Details <ArrowUpRight size={14} />
                            </button>
                         </div>
                       </section>
                     );
                   })}

                   {exams.filter(exam => submissions.some(s => s.examId === exam.id && s.status === 'completed')).length === 0 && (
                     <div className="py-40 text-center bg-white rounded-[48px] border-2 border-dashed border-slate-200">
                        <BarChart3 size={64} className="mx-auto text-slate-200 mb-6" />
                        <p className="text-slate-400 font-black uppercase tracking-widest text-sm italic">Neural transmission data buffer empty. Awaiting first submission.</p>
                     </div>
                   )}
                </div>
              </motion.div>
            )}
            {activeTab === 'surf' && (
              <motion.div
                key="surf"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="p-6 md:p-12"
              >                
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Floating Trash Zone */}
        <AnimatePresence>
          {isDraggingAny && (
            <motion.div
              ref={trashRef}
              initial={{ scale: 0, opacity: 0, y: 100 }}
              animate={{ 
                scale: isOverTrash ? 1.2 : 1, 
                opacity: 1, 
                y: 0,
                backgroundColor: isOverTrash ? "#ef4444" : "#dc2626",
                boxShadow: isOverTrash ? "0 0 50px rgba(239, 68, 68, 0.6)" : "0 25px 50px -12px rgba(220, 38, 38, 0.5)"
              }}
              exit={{ scale: 0, opacity: 0, y: 100 }}
              className="fixed bottom-12 right-12 w-32 h-32 rounded-full flex flex-col items-center justify-center text-white z-[100] border-4 border-white/20 transition-colors"
            >
              <Trash2 size={40} className={cn("mb-2", isOverTrash ? "animate-none scale-125" : "animate-bounce")} />
              <span className="text-[10px] font-black uppercase tracking-widest">{isOverTrash ? 'Release to Purge' : 'Drop to Purge'}</span>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Exam Purge Confirmation Modal */}
        {examToDelete && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 md:p-8 bg-slate-950/90 backdrop-blur-xl">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="bg-white rounded-[40px] w-full max-w-lg overflow-hidden shadow-2xl p-8 md:p-12 border border-red-100 flex flex-col items-center text-center"
            >
              <div className="w-16 h-16 md:w-20 md:h-20 bg-red-100 rounded-3xl flex items-center justify-center text-red-600 mb-8">
                <Trash2 size={40} />
              </div>
              
              <h2 className="text-[10px] font-black text-red-600 uppercase tracking-[0.4em] mb-4">Exam Purge Protocol</h2>
              <h1 className="text-2xl md:text-3xl font-black italic tracking-tighter uppercase mb-6 leading-tight">
                Purge Session: <span className="text-red-600">{examToDelete.title}</span>?
              </h1>

              <div className="p-6 bg-red-50 rounded-3xl border border-red-100 mb-8 w-full text-left">
                <p className="text-xs font-bold text-red-800 leading-relaxed">
                  Purging this exam will permanently remove all question structures and disconnect it from candidate results. Type <span className="underline font-black">delete</span> below to authorize.
                </p>
              </div>

              <input 
                autoFocus
                value={examDeleteConfirm}
                onChange={e => setExamDeleteConfirm(e.target.value)}
                placeholder="Type 'delete' to confirm"
                className="w-full p-4 md:p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl mb-6 text-center font-black uppercase tracking-widest text-slate-900 outline-none focus:border-red-500 transition-colors"
              />

              <div className="flex gap-4 w-full">
                <button 
                  onClick={() => { setExamToDelete(null); setExamDeleteConfirm(''); }}
                  className="flex-1 py-4 md:py-5 bg-slate-100 text-slate-400 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-slate-200 transition-all"
                >
                  Abort
                </button>
                <button 
                  disabled={examDeleteConfirm.toLowerCase() !== 'delete'}
                  onClick={() => {
                    deleteExam(examToDelete.id);
                    setExamToDelete(null);
                    setExamDeleteConfirm('');
                  }}
                  className="flex-[2] py-4 md:py-5 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-red-500/30 hover:bg-red-700 transition-all disabled:opacity-50 disabled:grayscale"
                >
                  Authorize Purge
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {userToDelete && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-8 bg-slate-950/90 backdrop-blur-xl">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="bg-white rounded-[40px] w-full max-w-lg overflow-hidden shadow-2xl p-12 border border-red-100 flex flex-col items-center text-center"
            >
              <div className="w-20 h-20 bg-red-100 rounded-3xl flex items-center justify-center text-red-600 mb-8">
                <AlertTriangle size={40} />
              </div>
              
              <h2 className="text-[10px] font-black text-red-600 uppercase tracking-[0.4em] mb-4">Account Purge Protocol</h2>
              <h1 className="text-3xl font-black italic tracking-tighter uppercase mb-6 leading-tight">
                Void Profile: <span className="text-red-600">{userToDelete.displayName}</span>?
              </h1>

              <div className="p-6 bg-red-50 rounded-3xl border border-red-100 mb-8 w-full text-left">
                <p className="text-xs font-bold text-red-800 leading-relaxed">
                  Executing this protocol will permanently erase <span className="underline">{userToDelete.email}</span> and all associated assessment data from the JEE - Mock database. This action is irreversible.
                </p>
              </div>

              <div className="w-full space-y-6">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block italic">
                    Type 'delete' to confirm account voiding
                  </label>
                  <input 
                    type="text"
                    value={adminDeleteConfirm}
                    onChange={(e) => setAdminDeleteConfirm(e.target.value)}
                    placeholder="ENTER COMMAND"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-center font-black text-lg tracking-widest focus:outline-none focus:border-red-500 transition-all text-slate-900 placeholder:text-slate-300"
                  />
                </div>

                <div className="flex gap-4">
                  <button 
                    disabled={isPurging}
                    onClick={() => {
                      setUserToDelete(null);
                      setAdminDeleteConfirm('');
                    }}
                    className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-sm hover:bg-slate-200 transition-all uppercase tracking-widest disabled:opacity-50"
                  >
                    Abort
                  </button>
                  <button 
                    disabled={adminDeleteConfirm.toLowerCase() !== 'delete' || isPurging}
                    onClick={() => executeUserPurge(userToDelete.uid)}
                    className="flex-[2] bg-red-600 text-white py-4 rounded-2xl font-black text-sm hover:bg-red-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-red-500/30 uppercase tracking-widest disabled:opacity-50 disabled:grayscale"
                  >
                    {isPurging ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>Initiate Purge <ChevronRight size={18} strokeWidth={3} /></>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

      </main>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-slate-900/80 backdrop-blur-md">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            className="bg-white rounded-[32px] w-full max-w-7xl overflow-hidden shadow-2xl"
          >
            <div className="p-10 border-b border-slate-100 flex justify-start items-center gap-8 bg-slate-50">
              <div>
                <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase italic">{editingExamId ? 'Update Session' : 'Schedule Session'}</h3>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">{editingExamId ? 'Modify Exam Parameters' : 'Configure Exam Parameters'}</p>
              </div>
              <div className="flex gap-4 items-center">
                <div className="bg-slate-200 p-1.5 rounded-2xl flex gap-1">
                  <button 
                    onClick={() => setAiMode('manual')}
                    className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all", aiMode === 'manual' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
                  >
                    Manual
                  </button>
                  <button 
                    onClick={() => setAiMode('ai')}
                    className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all", aiMode === 'ai' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-800")}
                  >
                    AI Generate
                  </button>
                  <button 
                    onClick={() => setAiMode('document')}
                    className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all", aiMode === 'document' ? "bg-white text-purple-600 shadow-sm" : "text-slate-500 hover:text-slate-800")}
                  >
                    AI Document Assistant
                  </button>
                </div>
                {editingExamId && (
                  <button 
                    onMouseDown={() => {
                      if (confirm('CRITICAL: Purge this exam session? All configurations will be lost.')) {
                        setDeleteHoldExamId(editingExamId);
                        deleteHoldIntervalRef.current = setInterval(() => {
                          setDeleteHoldProgress(p => {
                            if (p >= 100) return 100;
                            return p + 4; 
                          });
                        }, 50);
                      }
                    }}
                    onMouseUp={() => {
                      if (deleteHoldIntervalRef.current) clearInterval(deleteHoldIntervalRef.current);
                      setDeleteHoldProgress(0);
                      setDeleteHoldExamId(null);
                    }}
                    onMouseLeave={() => {
                      if (deleteHoldIntervalRef.current) clearInterval(deleteHoldIntervalRef.current);
                      setDeleteHoldProgress(0);
                      setDeleteHoldExamId(null);
                    }}
                    onTouchStart={() => {
                      if (confirm('CRITICAL: Purge this exam session?')) {
                        setDeleteHoldExamId(editingExamId);
                        deleteHoldIntervalRef.current = setInterval(() => {
                          setDeleteHoldProgress(p => {
                            if (p >= 100) return 100;
                            return p + 4;
                          });
                        }, 50);
                      }
                    }}
                    onTouchEnd={() => {
                      if (deleteHoldIntervalRef.current) clearInterval(deleteHoldIntervalRef.current);
                      setDeleteHoldProgress(0);
                      setDeleteHoldExamId(null);
                    }}
                    className="group relative w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all overflow-hidden"
                    title="HOLD TO PURGE"
                  >
                    <div 
                      className="absolute bottom-0 left-0 w-full bg-red-600 transition-all duration-75 origin-bottom" 
                      style={{ height: `${deleteHoldProgress}%` }} 
                    />
                    <Trash2 size={20} className="relative z-10" />
                  </button>
                )}
                <button onClick={() => { setShowCreateModal(false); resetForm(); }} className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-slate-400 hover:text-slate-900 hover:shadow-md transition-all"><Plus className="rotate-45" /></button>
              </div>
            </div>
            <div className="flex h-[75vh]">
              <div className="flex-1 overflow-y-auto p-10 space-y-8">
                {aiMode === 'ai' && (
                <div className="bg-blue-50/50 p-8 rounded-3xl border border-blue-100 space-y-6">
                  <div className="flex items-center gap-3 mb-2">
                    <Sparkles className="text-blue-600" size={24} />
                    <h4 className="text-lg font-black text-slate-900 italic tracking-tight">AI Assessment Core</h4>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Primary Topic</label>
                      <input 
                        value={aiTopic}
                        onChange={e => setAiTopic(e.target.value)}
                        placeholder="e.g. Quantum Mechanics, Calculus III, Organic Chemistry"
                        className="w-full bg-white border border-slate-200 p-4 rounded-xl font-bold outline-none focus:ring-4 focus:ring-blue-100 shadow-sm transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Complexity Level</label>
                      <select 
                        value={aiDifficulty}
                        onChange={e => setAiDifficulty(e.target.value)}
                        className="w-full bg-white border border-slate-200 p-4 rounded-xl font-bold outline-none focus:ring-4 focus:ring-blue-100 shadow-sm transition-all"
                      >
                        <option>Foundation (Easy)</option>
                        <option>Strategic (Medium)</option>
                        <option>Expert (Hard)</option>
                        <option>Extreme (JEE Advanced)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Volume</label>
                      <input 
                        type="number"
                        value={aiQuestionCount}
                        onChange={e => setAiQuestionCount(parseInt(e.target.value))}
                        className="w-full bg-white border border-slate-200 p-4 rounded-xl font-bold outline-none focus:ring-4 focus:ring-blue-100 shadow-sm transition-all"
                      />
                    </div>
                  </div>
                  <GlassButton 
                    onClick={handeAiGenerate}
                    disabled={aiIsGenerating}
                    className="w-full"
                    glassColor={aiIsGenerating ? "oklch(from var(--blue-600) l c h / 10%)" : undefined}
                    contentClassName="flex items-center justify-center gap-3 w-full"
                  >
                    {aiIsGenerating ? <Loader2 className="animate-spin" /> : <BrainCircuit size={18} />}
                    {aiIsGenerating ? "Neural Link Active..." : "Synthesize Exam Pattern"}
                  </GlassButton>
                </div>
              )}

              {aiMode === 'document' && (
                <div className="bg-purple-50/50 p-8 rounded-3xl border border-purple-100 space-y-6">
                  <div className="flex items-center gap-3 mb-2">
                    <FileUp className="text-purple-600" size={24} />
                    <h4 className="text-lg font-black text-slate-900 italic tracking-tight">External Resource Analysis</h4>
                  </div>
                  <div className="p-12 border-2 border-dashed border-purple-200 rounded-3xl bg-white text-center cursor-pointer hover:border-purple-400 transition-all group relative">
                    <input 
                      type="file"
                      onChange={handleFileUpload}
                      accept=".pdf,.png,.jpg,.jpeg,.ppt,.pptx,.doc,.docx"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <div className="space-y-4">
                      <div className="w-16 h-16 bg-purple-50 rounded-full flex items-center justify-center text-purple-600 mx-auto group-hover:scale-110 transition-transform">
                        <FileText size={32} />
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-900 uppercase">Input Sample Document</p>
                        <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest leading-relaxed">PDF, Word, or Images accepted.<br/>Limit 10MB per transmission.</p>
                      </div>
                    </div>
                  </div>
                  {aiIsGenerating && (
                    <div className="py-10 text-center animate-pulse">
                      <Loader2 className="animate-spin mx-auto text-purple-600 mb-4" />
                      <p className="text-xs font-black text-purple-600 uppercase tracking-widest">Parsing Structure & Errors...</p>
                    </div>
                  )}
                  {analysisResult && (
                    <div className="bg-white p-6 rounded-2xl border border-purple-200 space-y-4">
                      <h5 className="text-[10px] font-black text-purple-600 uppercase tracking-widest border-b border-purple-50 pb-2 flex items-center gap-2">
                        <AlertCircle size={12} /> Diagnostic Summary
                      </h5>
                      <p className="text-xs italic text-slate-600 font-medium leading-relaxed">{analysisResult.summary}</p>
                      
                      {analysisResult.questions && analysisResult.questions.length > 0 && (
                        <div className="mt-6 pt-6 border-t border-slate-100">
                          <h6 className="text-[10px] font-black text-slate-900 uppercase tracking-widest mb-4 flex items-center justify-between">
                            Question Paper Preview
                            <button 
                              onClick={() => {
                                const text = analysisResult.questions.map((q: any, i: number) => `Q${i+1}: ${q.text}\nAnswer: ${q.answer}\nExplanation: ${q.explanation}`).join('\n\n');
                                navigator.clipboard.writeText(text);
                                alert("Copied to clipboard!");
                              }}
                              className="text-purple-600 hover:text-purple-700 font-bold text-[8px] uppercase"
                            >
                              Copy All
                            </button>
                          </h6>
                          <div className="space-y-4">
                            {analysisResult.questions.map((q: any, i: number) => (
                              <div key={i} className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
                                <p className="text-xs font-bold text-slate-900">{i+1}. {q.text}</p>
                                <div className="text-[10px] text-slate-600 space-y-1">
                                  <p><span className="font-black uppercase">Answer:</span> {q.answer}</p>
                                  <p><span className="font-black uppercase">Explanation:</span> {q.explanation}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {analysisResult.errors?.length > 0 && (
                        <div className="space-y-2 pt-4 border-t border-slate-100">
                          <label className="text-[8px] font-black text-red-500 uppercase tracking-widest">Errors Detected:</label>
                          {analysisResult.errors.map((err: string, i: number) => (
                            <div key={i} className="bg-red-50 p-3 rounded-lg border border-red-100 flex items-center gap-2">
                              <AlertTriangle size={12} className="text-red-500 shrink-0" />
                              <span className="text-[10px] font-bold text-red-800">{err}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-6 relative">
                 <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Preparation Type</label>
                  <div className="flex gap-2">
                    {(['JEE', 'NEET', 'Both'] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => setPreparationTypeExam(p)}
                        className={cn(
                          "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                          preparationTypeExam === p ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Mock Exam Title</label>
                  <input 
                    value={examTitle}
                    onChange={(e) => setExamTitle(e.target.value)}
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:bg-white outline-none font-bold text-lg transition-all"
                    placeholder="e.g. JEE ADVANCED MOCK #01"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Total Minutes</label>
                  <input 
                    type="number"
                    value={examDuration}
                    onChange={(e) => setExamDuration(e.target.value)}
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:bg-white outline-none font-black text-xl transition-all"
                  />
                </div>
                <div>
                   <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Start Time</label>
                   <input 
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:bg-white outline-none font-bold text-sm transition-all"
                  />
                </div>
                <div className="col-start-2">
                   <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">End Time</label>
                   <input 
                    type="datetime-local"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:bg-white outline-none font-bold text-sm transition-all"
                  />
                </div>
              </div>
                <div className="border-t border-slate-100 pt-8">
                  <div className="flex justify-between items-center mb-6">
                    <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest italic">{activeCreationSection} Protocol</h4>
                    <div className="flex gap-2">
                      <button onClick={() => addQuestion('mcq')} className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-100">+ MCQ</button>
                      <button onClick={() => addQuestion('numerical')} className="bg-purple-50 text-purple-600 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-purple-100">+ NUM</button>
                    </div>
                  </div>                
                  <div className="flex gap-2 mb-6">
                    {(['Maths', 'Physics', 'Chemistry'] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => setActiveCreationSection(s)}
                        className={cn(
                          "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                          activeCreationSection === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest italic">{activeCreationSection} Protocol</h4>
                      <div className="flex gap-2">
                        <button onClick={() => addQuestion('mcq')} className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-100">+ MCQ</button>
                        <button onClick={() => addQuestion('numerical')} className="bg-purple-50 text-purple-600 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-purple-100">+ NUM</button>
                      </div>
                    </div>

                    <div className="space-y-6">
                      {([...(sectionsData?.[activeCreationSection]?.mcqs || []), ...(sectionsData?.[activeCreationSection]?.numericals || [])]).map((q, idx) => (
                        <div key={q.id} className="grid grid-cols-[1fr,300px] gap-6 group">
                          <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 space-y-4 relative hover:border-blue-300 transition-all">
                            <button type="button" onClick={() => removeQuestion(q.id)} className="absolute top-4 right-4 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                            
                            <div className="flex items-center gap-2">
                               <span className="w-8 h-8 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-xs font-black text-slate-400">{idx + 1}</span>
                               <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest italic border border-blue-100 px-2 py-0.5 rounded-lg">{q.type}</span>
                            </div>

                            <textarea 
                              value={q.text}
                              onFocus={() => setFocusedInput({ qId: q.id, field: 'text' })}
                              onChange={(e) => updateQuestion(q.id, 'text', e.target.value)}
                              onPaste={(e) => handlePasteImage(e, q.id, 'question')}
                              placeholder="Enter question text... Use the Neural Keypad for symbols. Paste images using Ctrl+V directly."
                              className="w-full bg-white border border-slate-200 rounded-2xl p-4 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-100 min-h-[100px]"
                              rows={3}
                            />
                            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5 ml-1">
                              <span>📋 Paste screenshots directly using Ctrl+V (supports multiple images).</span>
                            </div>

                            {((q.imageUrls && q.imageUrls.length > 0) ? q.imageUrls : (q.imageUrl ? [q.imageUrl] : [])).length > 0 && (
                              <div className="flex flex-wrap gap-4 mt-2">
                                {((q.imageUrls && q.imageUrls.length > 0) ? q.imageUrls : [q.imageUrl]).filter(Boolean).map((url: string, imgIdx: number) => (
                                  <div key={imgIdx} className="relative w-full max-w-xs group/img">
                                    <div className="absolute top-2 left-2 bg-slate-900/60 text-white text-[9px] font-black px-2 py-0.5 rounded-md backdrop-blur-sm z-10 uppercase tracking-wider">
                                      Image {imgIdx + 1}
                                    </div>
                                    <img 
                                      src={url} 
                                      alt={`Question Image ${imgIdx + 1}`} 
                                      referrerPolicy="no-referrer"
                                      className="rounded-2xl border border-slate-200 shadow-sm max-h-48 object-contain w-full" 
                                    />
                                    <button 
                                      type="button"
                                      onClick={() => removeQuestionImage(q.id, 'question', undefined, imgIdx)}
                                      className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-lg opacity-0 group-hover/img:opacity-100 transition-all z-10 shadow-md hover:bg-red-600"
                                      title="Remove this image"
                                    >
                                      <X size={12} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {q.type === 'mcq' && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {q.options.map((opt: string, optIdx: number) => (
                                  <div 
                                    key={optIdx} 
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={() => {
                                      if (draggedQId !== q.id || draggedOptionIdx === null || draggedOptionIdx === optIdx) return;
                                      
                                      const newOpts = [...q.options];
                                      const newOptImgs = [...(q.optionImages || ['', '', '', ''])];
                                      
                                      const tempNode = newOpts[draggedOptionIdx];
                                      newOpts[draggedOptionIdx] = newOpts[optIdx];
                                      newOpts[optIdx] = tempNode;
                                      
                                      const tempImg = newOptImgs[draggedOptionIdx];
                                      newOptImgs[draggedOptionIdx] = newOptImgs[optIdx];
                                      newOptImgs[optIdx] = tempImg;
                                      
                                      let newCorrectIdx = ['A', 'B', 'C', 'D'].indexOf(q.correctAnswer);
                                      if (newCorrectIdx === draggedOptionIdx) newCorrectIdx = optIdx;
                                      else if (newCorrectIdx === optIdx) newCorrectIdx = draggedOptionIdx;
                                      
                                      updateQuestion(q.id, 'options', newOpts);
                                      updateQuestion(q.id, 'optionImages', newOptImgs);
                                      updateQuestion(q.id, 'correctAnswer', ['A', 'B', 'C', 'D'][newCorrectIdx]);
                                      setDraggedOptionIdx(null);
                                      setDraggedQId(null);
                                    }}
                                    className="space-y-2"
                                  >
                                    <div className="flex gap-2 items-center">
                                      <span 
                                        draggable
                                        onDragStart={() => { setDraggedOptionIdx(optIdx); setDraggedQId(q.id); }}
                                        className="text-[10px] font-black text-slate-400 w-4 cursor-grab"
                                      >
                                        {String.fromCharCode(65 + optIdx)}
                                      </span>
                                      <textarea 
                                        value={opt}
                                        rows={2}
                                        onFocus={() => setFocusedInput({ qId: q.id, field: 'option', idx: optIdx })}
                                        onChange={(e) => {
                                          const newOpts = [...q.options];
                                          newOpts[optIdx] = e.target.value;
                                          updateQuestion(q.id, 'options', newOpts);
                                        }}
                                        onPaste={(e) => handlePasteImage(e, q.id, 'option', optIdx)}
                                        className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs font-medium outline-none focus:ring-4 focus:ring-blue-500/10 resize-none"
                                        placeholder={`Option ${String.fromCharCode(65 + optIdx)}`}
                                      />
                                    </div>
                                    {q.optionImages?.[optIdx] && (
                                      <div className="relative w-32 group/optimg ml-6">
                                        <img 
                                          src={q.optionImages[optIdx]} 
                                          alt={`Option ${optIdx}`} 
                                          referrerPolicy="no-referrer"
                                          className="rounded-xl border border-slate-100" 
                                        />
                                        <button 
                                          onClick={() => removeQuestionImage(q.id, 'option', optIdx)}
                                          className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-md opacity-0 group-hover/optimg:opacity-100 transition-all scale-75"
                                        >
                                          <X size={10} />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="p-4 bg-white border-2 border-slate-100 rounded-3xl shadow-xl z-20 self-start sticky top-24">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic block mb-2">Neural Key:</label>
                            {q.type === 'mcq' ? (
                              <div className="flex gap-2">
                                {['A', 'B', 'C', 'D'].map(char => (
                                  <button
                                    key={char}
                                    onClick={() => updateQuestion(q.id, 'correctAnswer', char)}
                                    className={cn(
                                      "w-12 h-12 rounded-2xl text-sm font-black transition-all",
                                      q.correctAnswer === char ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20" : "bg-white border-2 border-slate-100 text-slate-400 hover:bg-slate-50"
                                    )}
                                  >
                                    {char}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <input 
                                type="number"
                                value={q.correctAnswer}
                                onChange={(e) => updateQuestion(q.id, 'correctAnswer', parseFloat(e.target.value))}
                                className="w-24 bg-white border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-black outline-none focus:ring-4 focus:ring-blue-100"
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {((sectionsData?.[activeCreationSection]?.mcqs?.length || 0) === 0 && (sectionsData?.[activeCreationSection]?.numericals?.length || 0) === 0) && (
                      <div className="py-20 text-center border-2 border-dashed border-slate-200 rounded-[32px] bg-slate-50/50">
                         <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-slate-200 mx-auto mb-4 border border-slate-100">
                            <Plus size={32} />
                         </div>
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] italic">Void Buffer: No questions active in this sector.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="w-[400px] bg-slate-50 border-l border-slate-100 p-8">
                <NeuralKeypad insertSymbol={insertSymbol} />
              </div>
            </div>

            <div className="p-10 border-t border-slate-100 bg-white">
              <button 
                onClick={saveExam}
                className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/40 hover:-translate-y-1 active:translate-y-0"
              >
                SAVE AND SCHEDULE EXAM
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Create Student Modal */}
      {showCreateStudentModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-8 bg-slate-900/80 backdrop-blur-md">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
          >
            <div className="p-10">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-2xl font-black text-slate-900 tracking-tight">Register Student</h3>
                <button onClick={() => setShowCreateStudentModal(false)} className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-900 transition-all"><X size={20} /></button>
              </div>
              
              <form onSubmit={handleCreateStudent} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Full Name</label>
                  <input 
                    type="text" 
                    required
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-bold"
                    placeholder="e.g. Satish Kumar"
                  />
                </div>

               
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Role & Preparation</label>
                  <div className="flex gap-4 mb-3">
                     <button type="button" onClick={() => setNewStudentRole('student')} className={cn("px-4 py-2 rounded-xl text-[10px] font-bold uppercase", newStudentRole === 'student' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500')}>Student</button>
                     <button type="button" onClick={() => setNewStudentRole('admin')} className={cn("px-4 py-2 rounded-xl text-[10px] font-bold uppercase", newStudentRole === 'admin' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500')}>Admin</button>
                  </div>
                  <div className="flex gap-2">
                    {(['JEE', 'NEET', 'Both'] as const).map(p => (
                      <button key={p} type="button" onClick={() => setNewStudentPrepType(p)} className={cn("px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all", newStudentPrepType === p ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400 hover:bg-slate-200")}>{p}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Email Identity</label>
                  <input 
                    type="email" 
                    required
                    value={newStudentEmail}
                    onChange={(e) => setNewStudentEmail(e.target.value)}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-bold tracking-tight"
                    placeholder="student@conqueror.com"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Root Secret (Password)</label>
                  <input 
                    type="text" 
                    required
                    value={newStudentPassword}
                    onChange={(e) => setNewStudentPassword(e.target.value)}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-mono font-bold text-blue-600"
                    placeholder="Min 6 characters"
                    minLength={6}
                  />
                </div>

                <div className="pt-4">
                  <button 
                    type="submit"
                    disabled={isCreatingStudent}
                    className="w-full py-5 bg-blue-600 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-blue-500/30 hover:bg-blue-700 hover:-translate-y-1 active:translate-y-0 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {isCreatingStudent ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={18} />}
                    {isCreatingStudent ? 'PROVISIONING...' : 'CONFIRM PROVISIONING'}
                  </button>
                  <p className="mt-4 text-[10px] text-slate-400 font-medium text-center italic">Account will be provisioned with standard student role permissions.</p>
                </div>
              </form>
            </div>
          </motion.div>
        </div>
      )}

      {/* Hold to Preview Modal */}
      <AnimatePresence>
        {previewHoldExam && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-[48px] w-full max-w-xl p-12 text-center shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-slate-100">
                <div className="h-full bg-blue-600 transition-all duration-100" style={{ width: `${holdProgress}%` }} />
              </div>

              <div className="w-20 h-20 bg-blue-500/10 rounded-3xl flex items-center justify-center text-blue-600 mx-auto mb-8">
                <AlertTriangle size={40} />
              </div>
              
              <h3 className="text-3xl font-black text-slate-900 uppercase tracking-tight mb-4 italic">Initialize Secure Bridge?</h3>
              <p className="text-slate-500 font-bold uppercase tracking-widest text-xs mb-12 leading-relaxed">
                You are initiating a high-privilege session preview. All responses in this mode are for diagnostic purposes and will not affect global aggregates.
              </p>

              <div className="space-y-4">
                <button 
                  onMouseDown={() => {
                    holdIntervalRef.current = setInterval(() => {
                      setHoldProgress(p => {
                        if (p >= 100) return 100;
                        return p + 5; // Faster for admin testing
                      });
                    }, 50);
                  }}
                  onMouseUp={() => {
                    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
                    setHoldProgress(0);
                  }}
                  onMouseLeave={() => {
                    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
                    setHoldProgress(0);
                  }}
                  onTouchStart={() => {
                     holdIntervalRef.current = setInterval(() => {
                      setHoldProgress(p => {
                        if (p >= 100) return 100;
                        return p + 5;
                      });
                    }, 50);
                  }}
                  onTouchEnd={() => {
                    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
                    setHoldProgress(0);
                  }}
                  className="w-full bg-slate-900 text-white py-6 rounded-3xl font-black uppercase tracking-[0.2em] relative overflow-hidden group active:scale-95 transition-all"
                >
                  <span className="relative z-10">HOLD TO INITIALIZE</span>
                  <div className="absolute inset-0 bg-blue-600 origin-left" style={{ transform: `scaleX(${holdProgress / 100})` }} />
                </button>
                
                <button 
                  onClick={() => { setPreviewHoldExam(null); setHoldProgress(0); }}
                  className="w-full bg-slate-100 text-slate-400 py-6 rounded-3xl font-black uppercase tracking-widest hover:bg-slate-200 hover:text-slate-600 transition-all"
                >
                  ABORT CONNECTION
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* Detailed Performance Review Modal */}
        {analyzingExam && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[130] bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 30 }}
              className="bg-white rounded-[48px] w-full max-w-7xl max-h-[95vh] overflow-hidden flex flex-col p-12 shadow-2xl relative"
            >
              <button 
                onClick={() => setAnalyzingExam(null)}
                className="absolute top-12 right-12 p-4 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-all text-slate-600 z-10"
              >
                <X size={24} />
              </button>

              <div className="mb-12">
                <h2 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em] mb-4">Exam Performance Analytics</h2>
                <h1 className="text-5xl font-black italic tracking-tighter uppercase mb-4 leading-none">
                  {analyzingExam.title}
                </h1>
                <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Total Submissions: 0</p>
              </div>

              <div className="flex-1 overflow-y-auto pr-6 custom-scrollbar space-y-12">
                {analyzingExam && analyzingExam.sections && Object.entries(analyzingExam.sections).map(([sectionName, section]: [string, any]) => (
                  <div key={sectionName} className="space-y-6">
                    <h3 className="text-2xl font-black italic uppercase tracking-tighter text-slate-400 border-b-4 border-slate-100 pb-4">{sectionName} Breakdown</h3>
                    <div className="grid grid-cols-1 gap-6">
                      {[...section.mcqs, ...section.numericals].map((q, idx) => {
                        const qSubmissions = submissions.filter(s => s.examId === analyzingExam.id && s.status === 'completed');
                        const totalAttempts = qSubmissions.filter(s => s.answers?.[q.id]?.status === 'attempted' || s.answers?.[q.id]?.status === 'marked').length;
                        const correctAttempts = qSubmissions.filter(s => {
                          const ans = s.answers?.[q.id];
                          const correct = analyzingExam.answerKey[q.id];
                          if (!ans || !correct) return false;
                          return typeof correct === 'number' 
                            ? Math.abs(Number(ans.value) - Number(correct)) < 0.01 
                            : String(ans.value).trim().toUpperCase() === String(correct).trim().toUpperCase();
                        }).length;

                        const optionCounts = q.type === 'mcq' ? ['A', 'B', 'C', 'D'].map(char => ({
                          char,
                          count: qSubmissions.filter(s => s.answers?.[q.id]?.value === char).length
                        })) : [];

                        return (
                          <div key={q.id} className="p-8 bg-slate-50 border border-slate-200 rounded-[32px] group hover:border-blue-300 transition-all">
                            <div className="flex justify-between items-start gap-12">
                              <div className="flex-1">
                                <div className="flex items-center gap-4 mb-6">
                                  <span className="w-10 h-10 flex items-center justify-center bg-slate-900 text-white rounded-2xl text-xs font-black">{idx + 1}</span>
                                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-white px-4 py-1.5 rounded-full border border-slate-200">Neural Node {q.id}</span>
                                </div>
                                <p className="text-xl font-black text-slate-800 uppercase italic mb-8 leading-tight tracking-tight">{q.text}</p>
                                
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                                  <div className="p-6 bg-white border border-slate-200 rounded-2xl">
                                    <p className="text-[8px] font-black text-slate-400 uppercase mb-1 italic">Total Feedbacks</p>
                                    <p className="text-2xl font-black text-slate-900">{totalAttempts}</p>
                                  </div>
                                  <div className="p-6 bg-white border border-slate-200 rounded-2xl">
                                    <p className="text-[8px] font-black text-green-600 uppercase mb-1 italic">Correct Recalls</p>
                                    <p className="text-2xl font-black text-green-600">{correctAttempts}</p>
                                  </div>
                                  <div className="p-6 bg-white border border-slate-200 rounded-2xl">
                                    <p className="text-[8px] font-black text-red-600 uppercase mb-1 italic">Neural Mismatches</p>
                                    <p className="text-2xl font-black text-red-600">{totalAttempts - correctAttempts}</p>
                                  </div>
                                  <div className="p-6 bg-white border border-slate-200 rounded-2xl text-right">
                                    <p className="text-[8px] font-black text-blue-600 uppercase mb-1 italic">Accuracy Quotient</p>
                                    <p className="text-2xl font-black text-blue-600">{totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0}%</p>
                                  </div>
                                </div>

                                {q.type === 'mcq' && (
                                  <div className="space-y-3">
                                    {optionCounts.map(({ char, count }) => {
                                      const percentage = totalAttempts > 0 ? (count / totalAttempts) * 100 : 0;
                                      const isCorrect = analyzingExam.answerKey[q.id] === char;
                                      return (
                                        <div key={char} className="relative h-12 bg-white border border-slate-100 rounded-xl overflow-hidden group/bar">
                                          <motion.div 
                                            initial={{ width: 0 }}
                                            animate={{ width: `${percentage}%` }}
                                            className={cn(
                                              "absolute inset-0 opacity-20 transition-all",
                                              isCorrect ? "bg-green-500" : "bg-blue-500"
                                            )}
                                          />
                                          <div className="absolute inset-x-6 inset-y-0 flex items-center justify-between z-10">
                                            <div className="flex items-center gap-4">
                                              <span className={cn("w-6 h-6 flex items-center justify-center rounded-lg text-[10px] font-black", isCorrect ? "bg-green-500 text-white" : "bg-slate-100 text-slate-400")}>{char}</span>
                                              <span className={cn("text-xs font-black uppercase tracking-widest", isCorrect ? "text-green-700" : "text-slate-600")}>
                                                {count} Students {isCorrect && '(Correct Target)'}
                                              </span>
                                            </div>
                                            <span className="text-[10px] font-mono font-bold text-slate-400">{Math.round(percentage)}%</span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              {((q.imageUrls && q.imageUrls.length > 0) ? q.imageUrls : (q.imageUrl ? [q.imageUrl] : [])).length > 0 && (
                                <div className="w-80 shrink-0 flex flex-col gap-4">
                                  {((q.imageUrls && q.imageUrls.length > 0) ? q.imageUrls : [q.imageUrl]).filter(Boolean).map((url: string, imgIdx: number) => (
                                    <img 
                                      key={imgIdx}
                                      src={url} 
                                      alt={`Question Analysis ${imgIdx + 1}`} 
                                      className="w-full h-auto rounded-3xl border border-slate-200 shadow-sm"
                                      referrerPolicy="no-referrer"
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
        {reviewSubmission && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 30 }}
              className="bg-white rounded-[48px] w-full max-w-6xl max-h-[90vh] overflow-y-auto p-12 shadow-2xl relative custom-scrollbar flex flex-col animate-[fadeIn_0.2s_ease-out]"
            >
              <button 
                onClick={() => setReviewSubmission(null)}
                className="absolute top-6 right-6 md:top-12 md:right-12 p-3 md:p-4 bg-slate-100 rounded-xl md:rounded-2xl hover:bg-slate-200 transition-all text-slate-600 z-50 animate-bounce"
              >
                <X size={20} />
              </button>

              <div className="mb-8 md:mb-12 flex flex-col xl:flex-row justify-between items-start xl:items-end gap-6 md:gap-8 bg-white shrink-0">
                <div className="w-full">
                  <h2 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em] mb-2 md:mb-4">Integrity Performance Audit</h2>
                  <h1 className="text-3xl md:text-5xl font-black italic tracking-tighter uppercase mb-2 md:mb-4 leading-none">
                    {reviewSubmission.student.displayName}
                  </h1>
                  <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] md:text-xs">{reviewSubmission.exam.title} Section Analysis</p>

                  {/* Active Assessment Switcher */}
                  {(() => {
                    const studentSubs = submissions.filter(s => s.userId === reviewSubmission.student.uid && s.status === 'completed');
                    if (studentSubs.length > 1) {
                      return (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Selected Assessment Attempt:</span>
                          <select
                            value={reviewSubmission.sub.id}
                            onChange={(e) => {
                              const chosenSub = studentSubs.find(s => s.id === e.target.value);
                              if (chosenSub) {
                                const chosenExam = exams.find(ex => ex.id === chosenSub.examId);
                                if (chosenExam) {
                                  setReviewSubmission({ exam: chosenExam, sub: chosenSub, student: reviewSubmission.student });
                                }
                              }
                            }}
                            className="p-2 px-3 border border-slate-200 bg-white rounded-xl text-xs font-black text-slate-700 outline-none hover:border-blue-500 transition-all uppercase tracking-wider cursor-pointer"
                          >
                            {studentSubs.map(s => {
                              const examInfo = exams.find(ex => ex.id === s.examId);
                              const formattedTime = s.submittedAt ? format(s.submittedAt.toDate(), "dd MMM yyyy @ hh:mm a") : "Unknown Date";
                              return (
                                <option key={s.id} value={s.id}>
                                  {examInfo?.title || 'Unknown Exam'} — {formattedTime}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div className="flex flex-wrap gap-3 md:gap-4 w-full xl:w-auto">
                  {canDeleteUsers && (
                    <>
                      <button 
                        onClick={() => {
                          if (confirm('CRITICAL: Purge this candidate from existence?')) {
                            handleDeleteUser(reviewSubmission.student.uid);
                            setReviewSubmission(null);
                          }
                        }}
                        className="flex-1 xl:flex-none items-center justify-center gap-3 px-4 md:px-6 py-3 md:py-4 bg-red-100 text-red-600 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all hover:bg-red-200"
                      >
                        <Trash2 size={16} /> <span className="hidden sm:inline">Force Delete Account</span><span className="sm:hidden">Delete</span>
                      </button>
                      <button 
                        onClick={() => setShowDeleteModal(reviewSubmission.sub)}
                        className="flex-1 xl:flex-none items-center justify-center gap-3 px-4 md:px-6 py-3 md:py-4 bg-red-50 text-red-600 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all hover:bg-red-100 border border-red-200"
                      >
                        <Trash2 size={16} /> <span className="hidden sm:inline">Delete Submission</span><span className="sm:hidden">Delete</span>
                      </button>
                      {exportState.url ? (
                        <a
                          href={exportState.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex-1 xl:flex-none flex items-center justify-center gap-3 px-6 py-4 bg-green-600 text-white hover:bg-green-700 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all shadow-lg animate-pulse whitespace-nowrap"
                        >
                          <ArrowUpRight size={16} /> View Excel
                        </a>
                      ) : (
                        <button
                          onClick={() => handleExportAssessment(reviewSubmission.exam, reviewSubmission.sub, reviewSubmission.student)}
                          disabled={exportState.isLoading}
                          className="flex-1 xl:flex-none flex items-center justify-center gap-3 px-6 py-4 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 whitespace-nowrap"
                        >
                          {exportState.isLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin text-green-600" />
                              Working...
                            </>
                          ) : (
                            <>
                              <FileText className="text-green-600" size={16} />
                              Export to Sheets
                            </>
                          )}
                        </button>
                      )}
                      
                      <button
                        onClick={() => {
                          setDocExportState({
                            exam: reviewSubmission.exam,
                            studentName: reviewSubmission.student.displayName,
                            studentEmail: reviewSubmission.student.email
                          });
                          setCreatedDocUrl(null);
                        }}
                        className="flex-1 xl:flex-none flex items-center justify-center gap-3 px-6 py-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap active:scale-95"
                      >
                        <Printer className="text-indigo-600" size={16} />
                        Export Paper to Docs
                      </button>
                    </>
                  )}
                  {reviewSubmission.sub.integrityPhotos && reviewSubmission.sub.integrityPhotos.length > 0 && (
                    <button 
                      onClick={() => setShowPhotos(!showPhotos)}
                      className={cn(
                        "flex-1 xl:flex-none items-center justify-center gap-3 px-4 md:px-6 py-3 md:py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all",
                        showPhotos ? "bg-blue-600 text-white shadow-xl shadow-blue-500/30" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      )}
                    >
                      <Eye size={16} /> <span className="hidden sm:inline">POV Photos</span><span className="sm:hidden">Photos</span> ({reviewSubmission.sub.integrityPhotos.length})
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap md:flex-nowrap gap-6 md:gap-12 bg-slate-50 p-6 md:p-8 rounded-3xl border border-slate-100 w-full xl:w-auto">
                   {(() => {
                      const res = calculateSubmissionScore(reviewSubmission.exam, reviewSubmission.sub);
                      return (
                        <>
                          <div className="flex-1 md:flex-none text-center">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Score Matrix</p>
                            <p className="text-2xl md:text-4xl font-black text-blue-600">{res.score}</p>
                          </div>
                          <div className="flex-1 md:flex-none text-center">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Accuracy</p>
                            <p className="text-2xl md:text-4xl font-black text-green-600">
                              {res.correct + res.incorrect > 0 ? Math.round((res.correct / (res.correct + res.incorrect)) * 100) : 0}%
                            </p>
                          </div>
                          <div className="flex-1 md:flex-none text-center">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Final Sync</p>
                            <p className="text-2xl md:text-4xl font-black text-slate-900">{format(reviewSubmission.sub.submittedAt?.toDate() || new Date(), 'HH:mm')}</p>
                          </div>
                        </>
                      );
                   })()}
                </div>
              </div>

              {/* Show/Hide Detailed Metrics Control - Defaults to hidden to show only candidate's attempted questions and validation keys on scroll */}
              <div className="mb-8 flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.05em]">Metrics are collapsed to view ONLY student options selection & official validated answers.</p>
                </div>
                <button
                  onClick={() => setShowSectionMetrics(!showSectionMetrics)}
                  className="px-4 py-2.5 text-[9px] font-black bg-blue-50 text-blue-600 border border-blue-150 rounded-xl uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all select-none active:scale-95 cursor-pointer"
                >
                  {showSectionMetrics ? 'Hide Breakdown Board' : 'Show Subject Scoreboard Breakdown'}
                </button>
              </div>

              {showSectionMetrics && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 shrink-0">
                  {reviewSubmission && reviewSubmission.exam && reviewSubmission.exam.sections && Object.entries(reviewSubmission.exam.sections).map(([sectionName, section]: [string, any]) => {
                    const questions = [...section.mcqs, ...section.numericals];
                    let correctCount = 0;
                    let score = 0;

                    questions.forEach(q => {
                      const ans = reviewSubmission.sub.answers?.[q.id];
                      const correct = reviewSubmission.exam.answerKey[q.id];
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
                      <div key={sectionName} className="p-8 bg-slate-50 border border-slate-100 rounded-[32px] text-left animate-[slideDown_0.2s_ease-out]">
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
              )}

              {showPhotos && reviewSubmission.sub.integrityPhotos && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="mb-12 overflow-hidden"
                >
                  <div className="bg-slate-900 p-8 rounded-[32px] border border-slate-800">
                    <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-6">Visual Integrity Log (600s Intervals)</h3>
                    <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar">
                      {reviewSubmission.sub.integrityPhotos.map((photo, i) => (
                        <div key={i} className="shrink-0 group relative">
                          <img 
                            src={photo} 
                            alt={`Audit ${i}`} 
                            className="h-40 w-auto rounded-2xl border border-white/10 hover:border-blue-500 transition-all cursor-zoom-in" 
                            onClick={() => window.open(photo, '_blank')}
                          />
                          <div className="absolute bottom-3 left-3 px-2 py-1 bg-black/60 backdrop-blur-md rounded-lg text-[8px] font-black text-white uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">
                            Audit_NODE_{i+1}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {showSectionMetrics && (
                /* Neural Performance Matrix Table for Teachers */
                <div className="mb-12 shrink-0 animate-[slideDown_0.2s_ease-out]">
                  <div className="overflow-hidden border border-slate-100 rounded-[32px] bg-slate-50/50">
                    <table className="w-full text-left">
                      <thead className="bg-slate-100 border-b border-slate-200">
                        <tr>
                          <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Metadata Metric</th>
                          <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Neural Count</th>
                          <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Ratio Analysis</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(() => {
                          const res = calculateSubmissionScore(reviewSubmission.exam, reviewSubmission.sub);
                          const sections = (reviewSubmission.exam && reviewSubmission.exam.sections) ? Object.values(reviewSubmission.exam.sections) as any[] : [];
                          const totalQ: number = sections.reduce((acc: number, s: any) => acc + (s.mcqs?.length || 0) + (s.numericals?.length || 0), 0);
                          const rows: { label: string, val: number, color: string }[] = [
                            { label: 'Total Questions Injected', val: totalQ, color: 'text-slate-900' },
                            { label: 'Attempted (Neural Bridges)', val: ((reviewSubmission.sub.correctCount ?? res.correct) as number) + ((reviewSubmission.sub.incorrectCount ?? res.incorrect) as number), color: 'text-blue-600' },
                            { label: 'Correct Identifications', val: (reviewSubmission.sub.correctCount ?? res.correct) as number, color: 'text-green-600' },
                            { label: 'Incorrect Terminations', val: (reviewSubmission.sub.incorrectCount ?? res.incorrect) as number, color: 'text-red-500' },
                            { label: 'Unattempted (Neural Void)', val: (reviewSubmission.sub.skippedCount ?? res.skipped) as number, color: 'text-slate-400' }
                          ];
                          return rows.map((row, i) => (
                            <tr key={i} className="hover:bg-white transition-colors">
                              <td className="px-8 py-5">
                                <span className={cn("text-[10px] font-black uppercase tracking-widest", row.color)}>{row.label}</span>
                              </td>
                              <td className="px-8 py-5 text-center">
                                <span className={cn("text-xl font-black italic tracking-tighter", row.color)}>{row.val}</span>
                              </td>
                              <td className="px-8 py-5 text-right">
                                <span className="text-[10px] font-bold text-slate-400 font-mono">
                                  {(totalQ as number) > 0 ? Math.round(((row.val as number) / (totalQ as number)) * 100) : 0}%
                                </span>
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="w-full space-y-6">
                {reviewSubmission && reviewSubmission.exam && reviewSubmission.exam.sections && Object.values(reviewSubmission.exam.sections).flatMap((s: any) => [...(s.mcqs || []), ...(s.numericals || [])]).map((q, idx) => {
                  const ans = reviewSubmission.sub.answers?.[q.id];
                  const correct = reviewSubmission.exam.answerKey[q.id];
                  
                  const isCorrect = typeof correct === 'number' 
                    ? Math.abs(Number(ans?.value) - Number(correct)) < 0.01 
                    : String(ans?.value).trim().toUpperCase() === String(correct).trim().toUpperCase();

                  const isAttempted = ans?.status === 'attempted' || ans?.status === 'marked';

                  return (
                    <div key={q.id} className="p-6 md:p-10 bg-slate-50 border border-slate-100 rounded-3xl md:rounded-[40px] flex flex-col lg:flex-row items-start justify-between gap-6 md:gap-10 hover:border-blue-200 transition-all group">
                      <div className="flex-1">
                         <div className="flex items-center gap-4 mb-6">
                            <span className="w-10 h-10 flex items-center justify-center bg-slate-900 text-white rounded-2xl text-xs font-black shadow-lg shadow-black/10">{idx + 1}</span>
                            <span className="text-xs font-black text-slate-400 uppercase tracking-widest bg-white px-4 py-1.5 rounded-full border border-slate-200">Section {q.id[0]}</span>
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
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-8 bg-white border border-slate-200 rounded-3xl">
                                <div>
                                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Student Selection</p>
                                   <div className={cn(
                                     "inline-block px-10 py-4 rounded-2xl text-2xl font-black italic tracking-tighter",
                                     ans?.value ? (isCorrect ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700") : "bg-slate-100 text-slate-400"
                                   )}>
                                      {ans?.value || 'VOID'}
                                   </div>
                                </div>
                                <div>
                                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Validated Answer</p>
                                   <div className="inline-block px-10 py-4 bg-blue-100 text-blue-700 rounded-2xl text-2xl font-black italic tracking-tighter">
                                      {correct}
                                   </div>
                                </div>
                             </div>
                             {ans?.timeSpent !== undefined && (
                                <div className="p-8 bg-slate-900 rounded-3xl border border-slate-800 flex items-center justify-between">
                                   <div>
                                      <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Time to Completion</p>
                                      <p className="text-2xl font-black text-white italic tracking-tighter">
                                        {Math.floor(ans.timeSpent / 60)}m {ans.timeSpent % 60}s
                                      </p>
                                   </div>
                                   <div className="text-right">
                                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 italic">Efficiency Node</p>
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
                                        "p-6 rounded-2xl border-2 text-sm font-black uppercase transition-all shadow-sm flex flex-col gap-3",
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
                                          className="max-h-24 w-auto object-contain rounded-lg border border-white/50 cursor-pointer hover:scale-105 transition-transform" 
                                          onClick={() => window.open(q.optionImages[i], '_blank')}
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
                                   <p className={cn("text-[10px] font-black uppercase tracking-widest mb-2", isCorrect ? "text-green-600" : isAttempted ? "text-red-500" : "text-slate-400")}>Student Response</p>
                                   <p className={cn("text-2xl font-black", isCorrect ? "text-green-700" : isAttempted ? "text-red-700" : "text-slate-900")}>{ans?.value || 'NO_RESP'}</p>
                                </div>
                                <div className="p-8 bg-blue-50 border-2 border-blue-100 rounded-3xl shadow-sm">
                                   <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-2">Target Variable</p>
                                   <p className="text-2xl font-black text-blue-700">{correct}</p>
                                </div>
                             </div>
                           )}
                         </div>
                      </div>
                      
                      <div className="flex flex-row lg:flex-col items-center justify-center lg:w-40 shrink-0 h-full lg:mt-12 gap-4 w-full lg:w-auto">
                         {isAttempted ? (
                           isCorrect ? (
                             <div className="w-16 h-16 md:w-20 md:h-20 bg-green-500 text-white rounded-2xl md:rounded-3xl flex items-center justify-center shadow-2xl shadow-green-500/30 transform group-hover:scale-110 transition-transform">
                               <CheckCircle2 className="w-8 h-8 md:w-10 md:h-10" strokeWidth={3} />
                             </div>
                           ) : (
                              <div className="w-16 h-16 md:w-20 md:h-20 bg-red-500 text-white rounded-2xl md:rounded-3xl flex items-center justify-center shadow-2xl shadow-red-500/30 transform group-hover:scale-110 transition-transform">
                               <X className="w-8 h-8 md:w-10 md:h-10" strokeWidth={3} />
                             </div>
                           )
                         ) : (
                           <div className="text-[10px] md:text-xs font-black text-slate-300 uppercase tracking-[0.2em] italic bg-slate-100 px-6 py-3 rounded-2xl">Void Entry</div>
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

      <AnimatePresence>
        {reportSelectStudent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[130] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-[32px] p-8 max-w-lg w-full shadow-2xl relative border border-slate-100"
            >
              <button
                onClick={() => setReportSelectStudent(null)}
                className="absolute top-6 right-6 p-2 bg-slate-100 rounded-xl hover:bg-slate-200 transition-all text-slate-600 cursor-pointer"
              >
                <X size={16} />
              </button>

              <h2 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] mb-1">Analytical Report Base</h2>
              <h3 className="text-xl font-black text-slate-900 mb-6 uppercase tracking-tight">
                Select Assessment Attempt
              </h3>
              
              <p className="text-xs text-slate-500 mb-4 font-semibold pb-2 border-b border-slate-100">
                Select which of <span className="text-slate-850 font-black uppercase text-blue-600">{reportSelectStudent.displayName}</span>'s completed exam attempts you wish to audit:
              </p>

              <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                {submissions
                  .filter(s => s.userId === reportSelectStudent.uid && s.status === 'completed')
                  .sort((a, b) => (b.submittedAt?.toMillis() || 0) - (a.submittedAt?.toMillis() || 0))
                  .map((sub) => {
                    const examInstance = exams.find(e => e.id === sub.examId);
                    const displayDate = sub.submittedAt
                      ? format(sub.submittedAt.toDate(), 'EEEE, d MMMM yyyy @ hh:mm:ss a')
                      : 'Unknown Time';
                    
                    const scoreResult = examInstance ? calculateSubmissionScore(examInstance, sub) : { score: 0 };

                    return (
                      <div
                        key={sub.id}
                        onClick={() => {
                          if (examInstance) {
                            setReviewSubmission({ exam: examInstance, sub, student: reportSelectStudent });
                            setReportSelectStudent(null);
                          } else {
                            alert('Associated exam template has been deleted.');
                          }
                        }}
                        className="p-4 bg-slate-50 hover:bg-blue-50/50 border border-slate-100 hover:border-blue-200 rounded-2xl cursor-pointer transition-all flex items-center justify-between group"
                      >
                        <div className="overflow-hidden mr-3">
                          <p className="text-xs font-black text-slate-800 uppercase tracking-tight truncate group-hover:text-blue-600 transition-colors">
                            {examInstance?.title || 'Unknown Exam'}
                          </p>
                          <p className="text-[9px] font-bold text-slate-400 font-mono mt-1">
                            {displayDate}
                          </p>
                        </div>
                        <div className="shrink-0 flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-xs font-black text-slate-950">{scoreResult.score} pts</p>
                            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Net Score</p>
                          </div>
                          <ChevronRight size={14} className="text-slate-400 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteModal && (
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6"
            >
                <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
                    <h3 className="text-lg font-black text-slate-900 mb-2 uppercase tracking-tight">Confirm Deletion</h3>
                    <p className="text-slate-500 text-xs mb-6">Type <span className="font-bold text-red-600">DELETE</span> to confirm. This action is irreversible and will permanently remove all data for "{showDeleteModal?.id}".</p>
                    <input 
                        className="w-full p-3 border border-slate-200 rounded-xl mb-4 font-mono text-center text-sm" 
                        value={deleteInput}
                        onChange={(e) => setDeleteInput(e.target.value)}
                        placeholder="Type DELETE here"
                    />
                    <div className="flex gap-3">
                        <button onClick={() => { setShowDeleteModal(null); setDeleteInput(''); }} className="flex-1 bg-slate-100 p-3 rounded-xl font-bold text-xs uppercase hover:bg-slate-200">Cancel</button>
                        <button 
                            onClick={() => {
                                if (deleteInput === 'DELETE') {
                                    handleDeleteSubmission(showDeleteModal);
                                    setShowDeleteModal(null);
                                    setDeleteInput('');
                                } else {
                                    alert('Please type "DELETE" exactly to confirm.');
                                }
                            }}
                            className="flex-1 bg-red-600 text-white p-3 rounded-xl font-bold text-xs uppercase hover:bg-red-700"
                        >Confirm</button>
                    </div>
                </div>
            </motion.div>
          )}
        </AnimatePresence>

      <AnimatePresence>
        {docExportState && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[140] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-[36px] p-8 max-w-md w-full shadow-2xl relative border border-slate-100 flex flex-col"
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
                        docExportState.studentEmail
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
                      docExportState.studentEmail
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
      </AnimatePresence>

      <ReviewButton />
    </div>
  );
}
