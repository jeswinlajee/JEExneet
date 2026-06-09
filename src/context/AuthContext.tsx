import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, mapUserRow, UserRow } from '../lib/supabase';
import { UserProfile } from '../types';

interface AuthContextType {
  user: { uid: string; email: string | null } | null;
  profile: UserProfile | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<{ uid: string; email: string | null } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Heartbeat for online status
  useEffect(() => {
    if (!user) return;

    const updateHeartbeat = async () => {
      try {
        await supabase
          .from('users')
          .update({ last_seen: new Date().toISOString() })
          .eq('id', user.uid);
      } catch (e) {
        console.error("Heartbeat failed", e);
      }
    };

    const interval = setInterval(updateHeartbeat, 300000); // 5 minutes
    const initialTimeout = setTimeout(updateHeartbeat, 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(initialTimeout);
    };
  }, [user?.uid]);

  // Subscribe to auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser({ uid: session.user.id, email: session.user.email });

        // Fetch profile
        try {
          const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single();

          if (data && !error) {
            setProfile(mapUserRow(data as UserRow));
          }
        } catch (err) {
          console.error("Error fetching profile:", err);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });

    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({ uid: session.user.id, email: session.user.email });
        supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single()
          .then(({ data, error }) => {
            if (data && !error) {
              setProfile(mapUserRow(data as UserRow));
            }
            setLoading(false);
          });
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Poll for profile changes
  useEffect(() => {
    if (!user) return;

    const currentSessionId = sessionStorage.getItem('sessionId');
    if (!currentSessionId) {
      const newId = Math.random().toString(36).substring(7);
      sessionStorage.setItem('sessionId', newId);
    }

    const fetchProfile = async () => {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.uid)
        .single();

      if (data) {
        setProfile(mapUserRow(data as UserRow));
      }
    };

    const interval = setInterval(fetchProfile, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [user]);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
