// Timestamp-like object (replaces Firebase Timestamp)
export interface TimestampLike {
  seconds: number;
  nanoseconds: number;
}

export type UserRole = 'student' | 'staff' | 'admin';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  password?: string;
  sessionId?: string;
  sessionIds?: string[];
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  lastSeen?: TimestampLike;
  contactDetail?: string;
  review?: string;
  performanceInsight?: string;
  preparationType?: 'JEE' | 'NEET';
  requiresVerification?: boolean;
}

export interface Question {
  id: string;
  type: 'mcq' | 'numerical';
  text: string;
  imageUrl?: string;
  imageUrls?: string[];
  options?: string[]; // For MCQs
  optionImages?: string[]; // Corresponding images for options
  correctAnswer?: string | number;
}

export interface ExamSection {
  name: string;
  mcqs: Question[];
  numericals: Question[];
}

export interface Exam {
  id: string;
  title: string;
  startTime: TimestampLike;
  endTime: TimestampLike;
  duration: number; // minutes
  sections: {
    Maths: ExamSection;
    Physics: ExamSection;
    Chemistry: ExamSection;
  };
  answerKey: Record<string, string | number>;
  createdBy: string;
  createdAt: TimestampLike;
  submissionCount?: number;
  preparationType?: 'JEE' | 'NEET' | 'Both';
}

export interface SubmissionResponse {
  value: string | number | null;
  status: 'attempted' | 'marked' | 'skipped' | 'unattempted';
  timeSpent: number; // in seconds
}

export interface Submission {
  id: string;
  userId: string;
  examId: string;
  userName?: string;
  answers: Record<string, SubmissionResponse>;
  score: number;
  calculatedScore?: number;
  status: 'in-progress' | 'started' | 'completed';
  currentQuestionIndex?: number;
  currentSection?: string;
  lastHeartbeat?: TimestampLike;
  submittedAt?: TimestampLike;
  correctCount?: number;
  incorrectCount?: number;
  skippedCount?: number;
  integrityPhotos?: string[];
  hidden?: boolean;
}
