import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper functions to map between snake_case (DB) and camelCase (app)

export interface UserRow {
  id: string;
  display_name: string;
  email: string;
  role: 'student' | 'staff' | 'admin';
  password?: string;
  session_id?: string;
  session_ids?: string[];
  contact_detail?: string;
  review?: string;
  performance_insight?: string;
  preparation_type?: 'JEE' | 'NEET';
  requires_verification?: boolean;
  last_seen?: string;
  created_at: string;
  updated_at: string;
}

export interface ExamRow {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  duration: number;
  sections: any;
  answer_key: Record<string, string | number>;
  created_by: string;
  submission_count?: number;
  preparation_type?: 'JEE' | 'NEET' | 'Both';
  created_at: string;
  updated_at: string;
}

export interface SubmissionRow {
  id: string;
  user_id: string;
  exam_id: string;
  user_name?: string;
  answers: Record<string, any>;
  score: number;
  calculated_score?: number;
  status: 'started' | 'in-progress' | 'completed';
  current_question_index?: number;
  current_section?: string;
  last_heartbeat?: string;
  correct_count?: number;
  incorrect_count?: number;
  skipped_count?: number;
  integrity_photos?: string[];
  hidden?: boolean;
  created_at: string;
  updated_at: string;
  submitted_at?: string;
}

export function mapUserRow(row: UserRow) {
  return {
    uid: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    password: row.password,
    sessionId: row.session_id,
    sessionIds: row.session_ids,
    createdAt: { seconds: new Date(row.created_at).getTime() / 1000, nanoseconds: 0 },
    updatedAt: { seconds: new Date(row.updated_at).getTime() / 1000, nanoseconds: 0 },
    lastSeen: row.last_seen ? { seconds: new Date(row.last_seen).getTime() / 1000, nanoseconds: 0 } : undefined,
    contactDetail: row.contact_detail,
    review: row.review,
    performanceInsight: row.performance_insight,
    preparationType: row.preparation_type,
    requiresVerification: row.requires_verification,
  };
}

export function mapExamRow(row: ExamRow) {
  return {
    id: row.id,
    title: row.title,
    startTime: { seconds: new Date(row.start_time).getTime() / 1000, nanoseconds: 0 },
    endTime: { seconds: new Date(row.end_time).getTime() / 1000, nanoseconds: 0 },
    duration: row.duration,
    sections: row.sections,
    answerKey: row.answer_key,
    createdBy: row.created_by,
    submissionCount: row.submission_count,
    preparationType: row.preparation_type,
    createdAt: { seconds: new Date(row.created_at).getTime() / 1000, nanoseconds: 0 },
  };
}

export function mapSubmissionRow(row: SubmissionRow) {
  return {
    id: row.id,
    userId: row.user_id,
    examId: row.exam_id,
    userName: row.user_name,
    answers: row.answers,
    score: row.score,
    calculatedScore: row.calculated_score,
    status: row.status,
    currentQuestionIndex: row.current_question_index,
    currentSection: row.current_section,
    lastHeartbeat: row.last_heartbeat ? { seconds: new Date(row.last_heartbeat).getTime() / 1000, nanoseconds: 0 } : undefined,
    submittedAt: row.submitted_at ? { seconds: new Date(row.submitted_at).getTime() / 1000, nanoseconds: 0 } : undefined,
    correctCount: row.correct_count,
    incorrectCount: row.incorrect_count,
    skippedCount: row.skipped_count,
    integrityPhotos: row.integrity_photos,
    hidden: row.hidden,
  };
}
