import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, mapExamRow, mapSubmissionRow, ExamRow, SubmissionRow } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Exam, Submission, SubmissionResponse, ExamSection } from '../types';
import { calculateSubmissionScore } from '../lib/scoreUtils';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel
} from 'docx';
import { Timer, ChevronLeft, ChevronRight, TriangleAlert as AlertTriangle, Maximize2, BrainCircuit, Loader as Loader2, ShieldCheck, Zap, CircleCheck as CheckCircle2, Bookmark, FileDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface TestInterfaceProps {
  examId: string;
  onExit: () => void;
}

export default function TestInterface({ examId, onExit }: TestInterfaceProps) {
  const { profile } = useAuth();
  const [exam, setExam] = useState<Exam | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeSection, setActiveSection] = useState<'Maths' | 'Physics' | 'Chemistry'>('Maths');
  const [activeQuestionIdx, setActiveQuestionIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, SubmissionResponse>>({});
  const [sectionTimeSpent, setSectionTimeSpent] = useState<Record<string, number>>({});
  const [timeLeft, setTimeLeft] = useState(3 * 60 * 60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [stats, setStats] = useState({ correct: 0, incorrect: 0, skipped: 0 });
  const [timeLeftRedirect, setTimeLeftRedirect] = useState(15);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastInteractionTimeRef = useRef<number>(Date.now());

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);

  useEffect(() => {
    if (!exam || loading || showResult || isSubmitting) return;

    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('Camera API not supported');
        setCameraFailed(true);
        setCameraActive(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 240, height: 180 } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraActive(true);
          setCameraFailed(false);
        }
      } catch (err) {
        console.warn('Camera engagement failed:', err);
        setCameraFailed(true);
        setCameraActive(false);
      }
    };

    startCamera();

    const snapshotInterval = setInterval(() => {
      if (videoRef.current && canvasRef.current && cameraActive) {
        const context = canvasRef.current.getContext('2d');
        if (context) {
          context.drawImage(videoRef.current, 0, 0, 240, 180);
          const photo = canvasRef.current.toDataURL('image/jpeg', 0.3);

          if (!profile?.uid) return;
          const subId = `${profile.uid}_${examId}`;

          (async () => {
            try {
              // Fetch existing photos
              const { data: existing } = await supabase
                .from('submissions')
                .select('integrity_photos')
                .eq('id', subId)
                .single();

              const currentPhotos = existing?.integrity_photos || [];
              currentPhotos.push(photo);

              await supabase
                .from('submissions')
                .update({
                  integrity_photos: currentPhotos.slice(-20), // Keep last 20 photos
                  updated_at: new Date().toISOString()
                })
                .eq('id', subId);
            } catch (e) {
              console.error('PHOTO_SYNC_FAILURE', e);
            }
          })();
        }
      }
    }, 10 * 60 * 1000);

    return () => {
      clearInterval(snapshotInterval);
      if (videoRef.current?.srcObject) {
         const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
         tracks.forEach(track => track.stop());
      }
    };
  }, [exam, loading, showResult, isSubmitting, cameraActive, profile?.uid, examId]);

  // Auto-redirect after submission
  useEffect(() => {
    if (showResult && timeLeftRedirect > 0) {
      const timer = setInterval(() => {
        setTimeLeftRedirect(prev => prev - 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [showResult, timeLeftRedirect]);

  useEffect(() => {
    if (showResult && timeLeftRedirect <= 0) {
      onExit();
    }
  }, [showResult, timeLeftRedirect, onExit]);

  useEffect(() => {
    const fetchExam = async () => {
      const targetExamId = examId?.trim();

      if (!profile?.uid) {
        console.warn('INIT_SEQ: DEFERRED. Profile UID not found yet.');
        return;
      }

      console.log('INIT_SEQ: Starting fetch for targetExamId:', targetExamId, 'for profile:', profile.uid);
      setLoading(true);

      const timeout = setTimeout(() => {
        setLoading(false);
      }, 8000);

      try {
        if (!targetExamId) throw new Error('Exam ID is missing');

        // Fetch exam
        const { data: examData, error: examError } = await supabase
          .from('exams')
          .select('*')
          .eq('id', targetExamId)
          .single();

        if (examError || !examData) {
          console.error("EXAM_FETCH_FAILURE:", examError);
          return;
        }

        const examObj = mapExamRow(examData as ExamRow);
        examObj.id = targetExamId;
        setExam(examObj);
        setTimeLeft(Number(examObj.duration) > 0 ? Number(examObj.duration) * 60 : 180 * 60);

        const subId = `${profile.uid}_${targetExamId}`;
        console.log('INIT_SEQ: Synchronizing Submission State [ID: ' + subId + ']');

        // Fetch submission
        const { data: subData, error: subError } = await supabase
          .from('submissions')
          .select('*')
          .eq('id', subId)
          .single();

        if (subData && !subError) {
          const subObj = mapSubmissionRow(subData as SubmissionRow);
          if (subObj.status === 'completed') {
            console.log('INIT_SEQ: Submission Archive Found. Enforcing Single-Attempt lock.');
            setHoldProgress(-1);
            setLoading(false);
            return;
          } else {
            console.log('INIT_SEQ: Active Session Found. Answers count:', Object.keys(subObj.answers || {}).length);
            setAnswers(subObj.answers || {});
          }
        } else {
          console.log('INIT_SEQ: No Session Record. Initializing new archival node at /submissions/' + subId);
          await supabase
            .from('submissions')
            .insert({
              id: subId,
              user_id: profile.uid,
              user_name: profile.displayName,
              exam_id: targetExamId,
              status: 'started',
              answers: {},
              score: 0,
            });
        }
      } catch (err) {
        console.error('INIT_SEQ: CRITICAL_SYNC_FAILURE:', err);
      } finally {
        clearTimeout(timeout);
        setLoading(false);
      }
    };

    fetchExam();
  }, [examId, profile?.uid]);

  const enterFullscreen = useCallback(() => {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!exam || !profile || isSubmitting) return;

    setIsSubmitting(true);
    console.log('TRANS_SEQ: Initiating final aggregation.');

    try {
      const results = calculateSubmissionScore(exam, { answers } as any);
      const { score, correct: cCount, incorrect: incCount, skipped: skCount } = results;

      setFinalScore(score);
      setStats({ correct: cCount, incorrect: incCount, skipped: skCount });

      if (document.fullscreenElement) {
        try { await document.exitFullscreen(); } catch (e) {}
      }

      setIsSubmitting(false);
      setShowResult(true);

      const subId = `${profile.uid}_${examId}`;

      // Update submission
      await supabase
        .from('submissions')
        .update({
          user_id: profile.uid,
          user_name: profile.role === 'admin' ? 'Admin Testing' : profile.displayName,
          exam_id: examId,
          answers,
          score,
          calculated_score: score,
          correct_count: cCount,
          incorrect_count: incCount,
          skipped_count: skCount,
          status: 'completed',
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', subId);

      // Increment submission count
      const { data: examData } = await supabase
        .from('exams')
        .select('submission_count')
        .eq('id', examId)
        .single();

      if (examData) {
        await supabase
          .from('exams')
          .update({ submission_count: (examData.submission_count || 0) + 1 })
          .eq('id', examId);
      }
    } catch (error) {
      console.error('TRANS_SEQ: CRITICAL_FAILURE:', error);
      alert('TRANSMISSION DELAY: Your session data has been calculated locally, but the sync with the central server failed. Your result is being shown, but please contact the administrator to verify the sync. Error: ' + (error instanceof Error ? error.message : String(error)));

      setIsSubmitting(false);
      setShowResult(true);
    }
  }, [exam, profile, answers, examId, isSubmitting]);

  useEffect(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;

    const handleSecurityViolation = (event?: any) => {
      if (isMobile) return;

      if (isFullscreen && !isSubmitting && !showResult) {
        console.warn('SECURITY_VIOLATION: Event triggered AUTO_SUBMIT', event?.type);
        alert('SECURITY PROTOCOL TERMINATION: Unauthorized context switch detected. Session archived.');
        handleSubmit();
      }
    };

    const handleFullscreenChange = () => {
      const isStillFS = !!document.fullscreenElement;
      if (isFullscreen && !isStillFS && !isSubmitting && !showResult) {
        handleSecurityViolation({ type: 'fullscreenexit' });
      }
      setIsFullscreen(isStillFS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleSecurityViolation({ type: 'visibilityhidden' });
      }
    };

    window.addEventListener('blur', handleSecurityViolation);
    window.addEventListener('beforeunload', handleSecurityViolation);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      window.removeEventListener('blur', handleSecurityViolation);
      window.removeEventListener('beforeunload', handleSecurityViolation);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isFullscreen, handleSubmit, isSubmitting, showResult]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatTimeShort = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const downloadWordDoc = async () => {
    if (!exam) return;
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: exam.title, heading: HeadingLevel.HEADING_1 }),
          ...Object.entries(exam.sections).flatMap(([name, section]: [string, any]) => [
            new Paragraph({ text: name, heading: HeadingLevel.HEADING_2 }),
            ...(section.mcqs || []).map((q: any) => new Paragraph({ text: q.text })),
            ...(section.numericals || []).map((q: any) => new Paragraph({ text: q.text }))
          ])
        ]
      }]
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exam.title}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentQuestions = React.useMemo(() => exam ? [
    ...exam.sections[activeSection].mcqs,
    ...exam.sections[activeSection].numericals
  ] : [], [exam, activeSection]);

  const currentQuestion = currentQuestions[activeQuestionIdx];

  useEffect(() => {
    if (loading || !exam || showResult || isSubmitting) return;

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });

      if (currentQuestion) {
        setAnswers(prev => {
          const qId = currentQuestion.id;
          const currentAns = prev[qId] || { value: null, status: 'unattempted', timeSpent: 0 };
          return {
            ...prev,
            [qId]: {
              ...currentAns,
              timeSpent: (currentAns.timeSpent || 0) + 1
            }
          };
        });

        setSectionTimeSpent(prev => ({
          ...prev,
          [activeSection]: (prev[activeSection] || 0) + 1
        }));
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loading, exam, handleSubmit, currentQuestion, showResult, isSubmitting]);

  // Real-time progress synchronization for Live Monitor
  useEffect(() => {
    if (!exam || loading || showResult || isSubmitting) return;

    let syncInterval: NodeJS.Timeout;

    const updateLiveStatus = async () => {
      if (!exam || !profile?.uid) return;
      const subId = `${profile.uid}_${exam.id}`;
      try {
        await supabase
          .from('submissions')
          .update({
            user_id: profile.uid,
            user_name: profile.displayName,
            exam_id: exam.id,
            current_question_index: activeQuestionIdx,
            current_section: activeSection,
            last_heartbeat: new Date().toISOString(),
            status: 'in-progress',
            updated_at: new Date().toISOString()
          })
          .eq('id', subId);
        console.log('LIVE_SYNC: Heartbeat Dispatched');
      } catch (e) {
        console.warn("LIVE_SYNC: Heartbeat failed", e);
      }
    };

    updateLiveStatus();
    syncInterval = setInterval(updateLiveStatus, 30000);

    return () => {
      if (syncInterval) clearInterval(syncInterval);
    };
  }, [profile?.uid, exam?.id, loading, showResult, isSubmitting, activeQuestionIdx, activeSection]);

  useEffect(() => {
    if (holdProgress >= 100 && showConfirmModal) {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
      setShowConfirmModal(false);
      setHoldProgress(0);
      handleSubmit();
    }
  }, [holdProgress, showConfirmModal, handleSubmit]);

  const saveProgress = useCallback(async (currentAnswers: Record<string, SubmissionResponse>) => {
    if (!profile || !exam) return;
    try {
      const subId = `${profile.uid}_${examId}`;
      await supabase
        .from('submissions')
        .update({
          user_id: profile.uid,
          user_name: profile.displayName,
          answers: currentAnswers,
          updated_at: new Date().toISOString()
        })
        .eq('id', subId);
    } catch (error) {
      console.error('Error saving progress:', error);
    }
  }, [profile, exam, examId]);

  const handleAnswerSelect = (value: string | number | null) => {
    if (!currentQuestion) return;
    const qId = currentQuestion.id;
    const now = Date.now();
    const delta = Math.floor((now - lastInteractionTimeRef.current) / 1000);
    lastInteractionTimeRef.current = now;

    const newAnswers = {
      ...answers,
      [qId]: {
        ...answers[qId],
        value,
        status: (value === null || value === '') ? 'skipped' : 'attempted',
        timeSpent: (answers[qId]?.timeSpent || 0) + delta
      }
    };
    setAnswers(newAnswers);
    saveProgress(newAnswers);
  };

  const handleMarkReview = () => {
    if (!currentQuestion) return;
    const qId = currentQuestion.id;
    const newAnswers = {
      ...answers,
      [qId]: {
        ...answers[qId],
        status: 'marked'
      }
    };
    setAnswers(newAnswers);
    saveProgress(newAnswers);
    if (activeQuestionIdx < currentQuestions.length - 1) {
      setActiveQuestionIdx(prev => prev + 1);
    }
  };

  if (showResult) {
    const containerVariants = {
      hidden: { opacity: 0 },
      visible: {
        opacity: 1,
        transition: {
          staggerChildren: 0.1,
          delayChildren: 0.3
        }
      }
    };

    const itemVariants = {
      hidden: { y: 20, opacity: 0 },
      visible: { y: 0, opacity: 1 }
    };

    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 sm:p-12 text-white relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.1)_0%,transparent_70%)]" />

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="relative z-10 w-full max-w-4xl bg-white/5 border border-white/10 rounded-[48px] backdrop-blur-xl p-12 sm:p-20 text-center shadow-2xl"
        >
          <motion.div
            variants={itemVariants}
            className="w-24 h-24 bg-blue-600 rounded-3xl flex items-center justify-center text-white mx-auto mb-10 shadow-2xl shadow-blue-600/30"
          >
            <CheckCircle2 size={48} strokeWidth={3} />
          </motion.div>

          <motion.h2 variants={itemVariants} className="text-sm font-black text-blue-500 uppercase tracking-[0.4em] mb-4">Transmission Successful</motion.h2>
          <motion.h1 variants={itemVariants} className="text-6xl sm:text-7xl font-black italic tracking-tighter uppercase leading-none mb-4">
            Session <span className="text-blue-600">Summary</span>
          </motion.h1>
          <motion.p variants={itemVariants} className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-12 animate-pulse">Auto-redirecting to Hub in {timeLeftRedirect}s...</motion.p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-16">
            <motion.div variants={itemVariants} className="p-8 bg-white/5 rounded-3xl border border-white/10">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Aggregate Velocity</p>
              <p className="text-6xl font-black italic tracking-tighter text-blue-600">{finalScore}</p>
              <p className="text-[9px] font-bold text-slate-500 mt-2 tracking-widest uppercase">Formula: 4X - Y</p>
            </motion.div>
            <motion.div variants={itemVariants} className="p-8 bg-white/5 rounded-3xl border border-white/10 text-left">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Correct Nodes (X)</p>
              <p className="text-5xl font-black italic tracking-tighter text-green-500">+{stats.correct}</p>
              <p className="text-[9px] font-bold text-slate-500 mt-2 tracking-widest uppercase">Points: +{stats.correct * 4}</p>
            </motion.div>
            <motion.div variants={itemVariants} className="p-8 bg-white/5 rounded-3xl border border-white/10 text-left">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Fault Pattern (Y)</p>
              <p className="text-5xl font-black italic tracking-tighter text-red-500">-{stats.incorrect}</p>
              <p className="text-[9px] font-bold text-slate-500 mt-2 tracking-widest uppercase">Negative Impact: -{stats.incorrect}</p>
            </motion.div>
          </div>

          <motion.button
            variants={itemVariants}
            onClick={() => onExit()}
            className="group relative bg-white text-slate-950 px-12 py-6 rounded-3xl font-black text-xl uppercase tracking-widest transition-all hover:-translate-y-2 active:translate-y-0"
          >
            <span className="relative z-10 flex items-center gap-4">
              Return to Control Center <ChevronRight strokeWidth={3} />
            </span>
            <div className="absolute inset-0 bg-blue-600 rounded-3xl translate-y-2 translate-x-2 -z-10 group-hover:translate-x-0 group-hover:translate-y-0 transition-transform shadow-xl shadow-blue-500/30" />
          </motion.button>
        </motion.div>
      </div>
    );
  }

  if (holdProgress === -1) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-12 text-white text-center">
        <div className="w-24 h-24 bg-red-600 rounded-3xl flex items-center justify-center text-white mx-auto mb-10 shadow-2xl shadow-red-600/30">
          <AlertTriangle size={48} strokeWidth={3} />
        </div>
        <h1 className="text-6xl font-black italic uppercase tracking-tighter mb-4">Single Use <span className="text-red-500">Only</span></h1>
        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs mb-12 max-w-lg mx-auto">
          Security Protocol Violation: You have already completed this assessment cycle. Multiple initialization attempts are strictly forbidden by the Central Nexus.
        </p>
        <button
          onClick={onExit}
          className="bg-white text-slate-950 px-12 py-6 rounded-3xl font-black text-xl uppercase tracking-widest transition-all hover:bg-blue-600 hover:text-white"
        >
          Return to Control Center
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center space-y-8">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-16 h-16 border-t-4 border-b-4 border-blue-500 rounded-full" />
        <p className="text-blue-500 font-black uppercase tracking-[0.4em] text-sm animate-pulse">Initializing Secure Protocol</p>
      </div>
    );
  }

  if (!exam && !loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-12 text-white text-center">
        <h1 className="text-4xl font-black italic uppercase mb-2">Protocol Error: Resource Not Found</h1>
        <div className="text-slate-500 font-bold uppercase tracking-widest text-[10px] mb-8 bg-white/5 p-6 rounded-3xl border border-white/10 font-mono text-left max-w-lg mx-auto">
          <p className="border-b border-white/10 pb-2 mb-2 text-blue-500">DIAGNOSTIC_INFO:</p>
          ENDPOINT_ID: {examId}<br/>
          AUTH_STATE: {profile ? 'AUTHENTICATED' : 'ANONYMOUS'}<br/>
          PROFILE_ID: {profile?.uid || 'VOID'}<br/>
          ROLE: {profile?.role || 'UNDETERMINED'}<br/>
          TIMESTAMP: {new Date().toISOString()}
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20"
          >
            Retry Sync
          </button>
          <button
            onClick={onExit}
            className="bg-white/10 text-white px-8 py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-white/20 transition-all border border-white/10"
          >
            Return to Hub
          </button>
        </div>
      </div>
    );
  }

  if (!isFullscreen) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-12 text-white relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.1)_0%,transparent_70%)]" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 w-full max-w-4xl text-center"
        >
          <div className="inline-flex items-center gap-3 px-6 py-2 bg-blue-600/10 text-blue-400 rounded-full border border-blue-600/20 mb-12">
            <ShieldCheck size={18} className="animate-pulse" />
            <span className="text-xs font-black uppercase tracking-widest leading-none">Security Environment Level 4 Active</span>
          </div>

          <h1 className="text-8xl font-black italic tracking-tighter uppercase leading-none mb-8">
            Secure <span className="text-blue-600">Terminal</span> Access
          </h1>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16 text-left">
            {[
              { icon: <Timer />, label: 'Temporal Limit', val: '180:00:00' },
              { icon: <Zap />, label: 'Constraint Logic', val: '+4 / -1' },
              { icon: <ShieldCheck />, label: 'Secure Mode', val: 'Forced FS' }
            ].map((stat, i) => (
              <div key={i} className="p-8 bg-white/5 border border-white/10 rounded-[32px] backdrop-blur-sm group hover:border-blue-500 transition-colors">
                <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg shadow-blue-600/20">
                  {stat.icon}
                </div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{stat.label}</p>
                <p className="text-2xl font-black tracking-tight">{stat.val}</p>
              </div>
            ))}
          </div>

          <div className="bg-red-600/10 border border-red-600/20 p-8 rounded-[32px] mb-16 flex items-start gap-6 text-left">
            <AlertTriangle className="text-red-500 shrink-0" size={32} />
            <div>
              <p className="text-lg font-black text-white italic uppercase tracking-tight">Vulnerability Detection Service Is Active</p>
              <p className="text-sm text-slate-400 leading-relaxed font-medium mt-1">
                Any attempt to escape the secure environment (Esc, Alt+Tab, Window Blur) will result in immediate termination of the session and auto-submission of final payloads.
              </p>
            </div>
          </div>

          <button
            onClick={onExit}
            className="mb-8 flex items-center justify-center gap-2 text-slate-500 hover:text-white font-black uppercase tracking-widest transition-all text-sm"
          >
            <ChevronLeft size={20} /> Return to Hub
          </button>

          <button
            onClick={enterFullscreen}
            className="group relative bg-white text-slate-950 px-12 py-6 rounded-3xl font-black text-2xl uppercase tracking-widest transition-all hover:-translate-y-2 active:translate-y-0"
          >
            <span className="relative z-10 flex items-center gap-4">
              Initialize Terminal <ChevronRight strokeWidth={3} />
            </span>
            <div className="absolute inset-0 bg-blue-600 rounded-3xl translate-y-3 translate-x-3 -z-10 group-hover:translate-x-0 group-hover:translate-y-0 transition-transform shadow-xl shadow-blue-500/30" />
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-50 flex flex-col overflow-hidden select-none font-sans">
      <AnimatePresence>
        {isSubmitting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center space-y-8"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              className="w-24 h-24 border-t-4 border-blue-600 rounded-full shadow-[0_0_50px_rgba(37,99,235,0.3)]"
            />
            <div className="text-center">
              <h2 className="text-xl font-black text-white uppercase tracking-[0.5em] mb-2">Finalizing Aggregates</h2>
              <p className="text-blue-500 font-bold uppercase tracking-widest text-[10px] animate-pulse font-mono">Syncing with Central Nexus...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="h-14 md:h-24 bg-slate-950 text-white px-3 md:px-10 flex justify-between items-center shrink-0 z-[60]">
        <div className="flex items-center gap-2 md:gap-12">
          {/* Mobile Sidebar Toggle */}
          <button
            onClick={() => setShowMobileSidebar(!showMobileSidebar)}
            className="lg:hidden p-2 bg-slate-900 rounded-lg border border-slate-800 text-blue-500"
          >
            <BrainCircuit size={18} />
          </button>

          <div className="flex flex-col">
            <h1 className="text-[10px] md:text-base font-black tracking-tighter uppercase italic leading-none truncate max-w-[80px] md:max-w-none">{exam.title}</h1>
            <span className="text-[8px] md:text-[10px] font-bold text-blue-500 uppercase tracking-[0.2em] mt-1 hidden sm:inline">Secure Terminal Interface</span>
          </div>

          <div className="flex gap-1 md:gap-2">
            {(['Maths', 'Physics', 'Chemistry'] as const).map(s => (
              <button
                key={s}
                onClick={() => { setActiveSection(s); setActiveQuestionIdx(0); }}
                className={cn(
                  "px-2 md:px-8 py-1 md:py-3 rounded-lg md:rounded-2xl text-[7px] md:text-[10px] font-black uppercase tracking-widest transition-all",
                  activeSection === s ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20 border-transparent" : "text-slate-500 hover:text-white border border-slate-800"
                )}
              >
                {s.charAt(0)}<span className="hidden md:inline">{s.slice(1)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-10">
          <div className="flex items-center gap-1 md:gap-4 bg-slate-900 border border-slate-800 rounded-lg md:rounded-3xl p-1 md:p-2 px-2 md:px-6">
            <Timer size={12} className={cn("md:w-5 md:h-5", timeLeft < 300 ? "text-red-600 animate-pulse scale-125" : timeLeft < 600 ? "text-red-500 animate-pulse" : "text-blue-500")} />
            <span className={cn(
              "text-xs md:text-2xl font-black font-mono tracking-tighter w-16 md:w-32 text-center",
              timeLeft < 300 ? "text-red-600 font-bold" : timeLeft < 600 ? "text-red-500" : "text-white"
            )}>{formatTime(timeLeft)}</span>
          </div>

          {/* Critical Time Warning */}
          {timeLeft <= 300 && (
             <div className="absolute top-16 right-5 bg-red-600 text-white px-4 py-2 rounded-full font-black text-xs uppercase animate-bounce z-[100]">
               Critical Time: {Math.ceil(timeLeft/60)}m
             </div>
          )}

          <button
             onClick={downloadWordDoc}
             className="bg-purple-600 hover:bg-purple-700 h-8 md:h-14 px-3 md:px-6 rounded-lg md:rounded-2xl font-black text-[8px] md:text-sm uppercase tracking-widest shadow-xl shadow-purple-600/20 transition-all text-white flex items-center gap-2"
           >
             <FileDown size={16} />
             <span className="hidden md:inline">DOWNLOAD WORD</span>
           </button>

          <button
            onClick={() => setShowConfirmModal(true)}
            className="bg-blue-600 hover:bg-blue-700 h-8 md:h-14 px-3 md:px-10 rounded-lg md:rounded-2xl font-black text-[8px] md:text-sm uppercase tracking-widest shadow-xl shadow-blue-600/20 transition-all"
          >
            {/* Shortened for mobile */}
            <span className="md:hidden">SUBMIT</span>
            <span className="hidden md:inline">FINALIZE SESSION</span>
          </button>
        </div>
      </header>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirmModal && (
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

              <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center text-red-600 mx-auto mb-8">
                <AlertTriangle size={40} />
              </div>

              <h3 className="text-3xl font-black text-slate-900 uppercase tracking-tight mb-4 italic">Confirm Archival?</h3>
              <p className="text-slate-500 font-bold uppercase tracking-widest text-xs mb-12 leading-relaxed">
                You are about to transmit all saved aggregates to the central nexus. This will terminate your session and freeze your inputs permanently.
              </p>

              <div className="space-y-4">
                <button
                  onMouseDown={() => {
                    holdIntervalRef.current = setInterval(() => {
                      setHoldProgress(p => {
                        if (p >= 100) return 100;
                        return p + 2;
                      });
                    }, 20);
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
                        return p + 2;
                      });
                    }, 20);
                  }}
                  onTouchEnd={() => {
                    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
                    setHoldProgress(0);
                  }}
                  className="w-full bg-slate-900 text-white py-6 rounded-3xl font-black uppercase tracking-[0.2em] relative overflow-hidden group active:scale-95 transition-all"
                >
                  <span className="relative z-10">HOLD TO TRANSMIT</span>
                  <div className="absolute inset-0 bg-blue-600 origin-left" style={{ transform: `scaleX(${holdProgress / 100})` }} />
                </button>

                <button
                  onClick={() => { setShowConfirmModal(false); setHoldProgress(0); }}
                  className="w-full bg-slate-100 text-slate-400 py-6 rounded-3xl font-black uppercase tracking-widest hover:bg-slate-200 hover:text-slate-600 transition-all"
                >
                  ABORT & RESUME
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content Area */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Question Area */}
        <div className="flex-1 overflow-y-auto p-3 md:p-20 bg-white relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${activeSection}-${activeQuestionIdx}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-5xl mx-auto"
            >
              <div className="flex items-center justify-between mb-4 md:mb-16 border-b border-slate-100 pb-2 md:pb-8">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2 md:gap-3">
                    <span className="text-[7px] md:text-[10px] font-black uppercase text-slate-400 tracking-widest">Diagnostic Node</span>
                    <span className="w-1 h-1 md:w-1.5 md:h-1.5 bg-blue-500 rounded-full" />
                    <span className="text-[7px] md:text-[10px] font-black uppercase text-blue-600 tracking-widest">{activeSection} | Section {activeQuestionIdx < 20 ? 'A' : 'B'}</span>
                  </div>
                  <h2 className="text-base md:text-4xl font-black text-slate-900 mt-1 md:mt-2 uppercase tracking-tight">Question #{activeQuestionIdx + 1}</h2>
                </div>
                <div className="text-right">
                  <p className="text-[7px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Logic Pattern</p>
                  <p className="text-[8px] md:text-sm font-bold text-slate-900 border-b-2 border-blue-600 inline-block uppercase mt-0.5 md:mt-1">{currentQuestion.type === 'mcq' ? 'MCQ' : 'Numerical'}</p>
                </div>
              </div>

              <div className="text-sm md:text-2xl font-bold text-slate-800 mb-6 md:mb-16 leading-relaxed bg-slate-50 p-4 md:p-12 rounded-2xl md:rounded-[40px] border border-slate-100 italic">
                {currentQuestion.text}
                {((currentQuestion.imageUrls && currentQuestion.imageUrls.length > 0) ? currentQuestion.imageUrls : (currentQuestion.imageUrl ? [currentQuestion.imageUrl] : [])).length > 0 && (
                  <div className="mt-4 md:mt-8 flex flex-col gap-4">
                    {((currentQuestion.imageUrls && currentQuestion.imageUrls.length > 0) ? currentQuestion.imageUrls : [currentQuestion.imageUrl]).filter(Boolean).map((url: string, imgIdx: number) => (
                      <img
                        key={imgIdx}
                        src={url}
                        alt={`Question Attachment ${imgIdx + 1}`}
                        referrerPolicy="no-referrer"
                        className="max-w-full h-auto rounded-xl md:rounded-2xl border border-slate-200 shadow-sm"
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
                {currentQuestion.type === 'mcq' ? (
                  currentQuestion.options?.map((opt, i) => {
                    const label = String.fromCharCode(65 + i);
                    const isSelected = answers[currentQuestion.id]?.value === label;
                    return (
                      <button
                        key={i}
                        onClick={() => handleAnswerSelect(label)}
                        className={cn(
                          "flex items-center gap-3 md:gap-6 p-3 md:p-6 rounded-2xl md:rounded-[32px] border-2 text-left transition-all active:scale-95 group",
                          isSelected
                            ? "border-blue-600 bg-blue-50 shadow-xl shadow-blue-500/10"
                            : "border-slate-100 hover:border-slate-300 bg-white"
                        )}
                      >
                        <div className={cn(
                          "w-8 h-8 md:w-12 md:h-12 shrink-0 rounded-xl md:rounded-2xl flex items-center justify-center font-black transition-all text-sm md:text-xl",
                          isSelected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400 group-hover:bg-slate-900 group-hover:text-white"
                        )}>
                          {label}
                        </div>
                        <div className="flex flex-col gap-1 md:gap-2">
                          <span className="text-sm md:text-lg font-bold text-slate-800">{opt}</span>
                          {currentQuestion.optionImages?.[i] && (
                            <img
                              src={currentQuestion.optionImages[i]}
                              alt={`Option ${label}`}
                              referrerPolicy="no-referrer"
                              className="max-h-20 md:max-h-32 w-auto object-contain rounded-lg border border-slate-100"
                            />
                          )}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="col-span-2 md:col-span-2 space-y-4 md:space-y-6">
                    <div className="flex flex-col gap-2 md:gap-4">
                      <p className="text-[8px] md:text-xs font-black text-slate-400 uppercase tracking-widest">Input Numerical Scalar</p>
                      <input
                        type="number"
                        step="any"
                        value={answers[currentQuestion.id]?.value || ''}
                        onChange={(e) => handleAnswerSelect(e.target.value)}
                        className="max-w-full md:max-w-md px-6 md:px-12 py-4 md:py-8 bg-slate-50 border-2 md:border-4 border-slate-100 rounded-2xl md:rounded-[32px] text-2xl md:text-5xl font-black text-slate-900 focus:border-blue-600 focus:bg-white outline-none transition-all tracking-tighter"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Sidebar palette */}
        <AnimatePresence>
          {(showMobileSidebar || window.innerWidth >= 1024) && (
            <motion.aside
              initial={window.innerWidth < 1024 ? { x: '100%' } : {}}
              animate={window.innerWidth < 1024 ? { x: 0 } : {}}
              exit={window.innerWidth < 1024 ? { x: '100%' } : {}}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={cn(
                "fixed inset-y-0 right-0 z-50 w-full md:w-[420px] bg-white border-l border-slate-100 flex flex-col shrink-0 shadow-2xl lg:shadow-none lg:relative lg:translate-x-0",
                !showMobileSidebar && "hidden lg:flex"
              )}
            >
              {/* Mobile Close Button */}
              <div className="lg:hidden p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Interaction Grid</span>
                <button onClick={() => setShowMobileSidebar(false)} className="p-2 text-slate-400"><ChevronRight /></button>
              </div>

              {/* Integrity Camera PiP - Smaller/Hidden on mobile to save space */}
              <div className="p-4 md:p-6 border-b border-slate-100 bg-slate-50 hidden md:block">
            <div className="relative aspect-video bg-black rounded-2xl overflow-hidden shadow-inner border-2 border-slate-200">
              {!cameraActive && (
                <div className="absolute inset-0 flex items-center justify-center text-slate-500 font-black text-[8px] md:text-[10px] uppercase tracking-widest text-center px-6">
                  {cameraFailed ? "Proctoring Camera Offline" : "Initializing Visual Integrity Node..."}
                </div>
              )}
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={cn("w-full h-full object-cover", !cameraActive && "hidden")}
              />
              <canvas ref={canvasRef} width="320" height="240" className="hidden" />
              <div className="absolute top-3 left-3 flex items-center gap-2 px-2 py-1 bg-black/60 backdrop-blur-md rounded-lg border border-white/20">
                <div className={cn("w-1.5 h-1.5 rounded-full", cameraActive ? "bg-green-500 animate-pulse" : "bg-red-500")} />
                <span className="text-[6px] md:text-[8px] font-black text-white uppercase tracking-widest">LIVE_POV</span>
              </div>
            </div>
          </div>
          <div className="flex-1 p-6 md:p-10 overflow-y-auto custom-scrollbar">
            <div className="mb-6 grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-4 rounded-xl">
                 <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Section Time</p>
                 <p className="text-sm font-black text-slate-800 font-mono">{formatTimeShort(sectionTimeSpent[activeSection] || 0)}</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl">
                 <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Question Time</p>
                 <p className="text-sm font-black text-slate-800 font-mono">{formatTimeShort(currentQuestion ? (answers[currentQuestion.id]?.timeSpent || 0) : 0)}</p>
              </div>
            </div>
            <h3 className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-4 md:mb-8 flex items-center gap-3">
              <BrainCircuit size={14} className="md:w-4 md:h-4" strokeWidth={3} /> Interaction Grid
            </h3>

            <div className="grid grid-cols-5 md:grid-cols-5 gap-2 md:gap-4">
              {currentQuestions.map((q, i) => {
                const sub = answers[q.id];
                const isSelected = activeQuestionIdx === i;
                return (
                  <button
                    key={q.id}
                    onClick={() => setActiveQuestionIdx(i)}
                    className={cn(
                      "w-full aspect-square rounded-xl md:rounded-2xl flex items-center justify-center text-[10px] md:text-xs font-black transition-all relative overflow-hidden",
                      isSelected ? "ring-2 md:ring-4 ring-blue-600 ring-offset-2 md:ring-offset-4" : "",
                      sub?.status === 'attempted' ? "bg-blue-600 text-white" :
                      sub?.status === 'marked' ? "bg-black text-white" :
                      sub?.status === 'skipped' ? "bg-slate-200 text-slate-600" :
                      "bg-slate-50 border border-slate-100 text-slate-300 hover:border-blue-300 hover:text-blue-500"
                    )}
                  >
                    {i + 1}
                    {sub?.status === 'attempted' && <div className="absolute top-1 right-1 w-1 h-1 md:w-1.5 md:h-1.5 bg-white rounded-full" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-8 md:mt-16 pt-8 md:pt-16 border-t border-slate-100 space-y-4 md:space-y-6">
              <h4 className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 md:mb-6 underline">Legend Protocol</h4>
              <div className="grid grid-cols-2 gap-2 md:gap-4">
                {[
                  { color: 'bg-blue-600', label: 'Committed' },
                  { color: 'bg-black', label: 'In Review' },
                  { color: 'bg-slate-200', label: 'Skipped' },
                  { color: 'bg-white border border-slate-200', label: 'Void' }
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 md:gap-3 text-[8px] md:text-[10px] font-black text-slate-600 uppercase tracking-tight">
                    <div className={cn("w-3 h-3 md:w-4 md:h-4 rounded-sm md:rounded-md", item.color)} /> {item.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-6 md:p-10 bg-slate-50 border-t border-slate-200 space-y-3 md:space-y-4">
            <div className="grid grid-cols-2 gap-3 md:gap-4">
              <button
                onClick={handleMarkReview}
                className="flex items-center justify-center gap-2 py-3 md:py-5 bg-black text-white rounded-2xl md:rounded-3xl text-[8px] md:text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all active:scale-95 shadow-xl shadow-black/10"
              >
                <Bookmark size={12} className="md:w-[14px] md:h-[14px]" strokeWidth={3} /> Flag Node
              </button>
              <button
                onClick={() => handleAnswerSelect(null)}
                className="flex items-center justify-center gap-2 py-3 md:py-5 bg-white border-2 border-slate-200 text-slate-400 rounded-2xl md:rounded-3xl text-[8px] md:text-[10px] font-black uppercase tracking-widest hover:border-slate-400 hover:text-slate-600 transition-all active:scale-95"
              >
                Clear Cache
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 md:gap-4">
              <button
                disabled={activeQuestionIdx === 0}
                onClick={() => setActiveQuestionIdx(prev => prev - 1)}
                className="py-4 md:py-6 bg-slate-200 text-slate-600 rounded-2xl md:rounded-3xl font-black flex items-center justify-center hover:bg-slate-300 disabled:opacity-30 transition-all active:scale-95"
              >
                <ChevronLeft className="md:w-6 md:h-6" strokeWidth={3} />
              </button>
              <button
                disabled={activeQuestionIdx === currentQuestions.length - 1}
                onClick={() => setActiveQuestionIdx(prev => prev + 1)}
                className="py-4 md:py-6 bg-blue-600 text-white rounded-2xl md:rounded-3xl font-black flex items-center justify-center hover:bg-blue-700 disabled:opacity-30 transition-all active:scale-95 shadow-xl shadow-blue-600/20"
              >
                <span className="hidden md:inline">Progression</span> <ChevronRight className="md:w-6 md:h-6" strokeWidth={3} />
              </button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
      `}</style>
    </div>
  );
}
