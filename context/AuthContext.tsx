import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

export interface User {
  id: string;
  name: string;
  email: string;
  targetRole: string;
  experienceLevel: string;
  background?: string;
  onboardingComplete?: boolean;
  emailVerified?: boolean;
  photoUri?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  pendingVerificationEmail: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (data: { name: string; email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (data: Partial<User>) => Promise<void>;
  completeOnboarding: (background: string, experienceLevel: string, targetRole: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  confirmEmailVerified: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem("user").then((data) => {
      if (data) setUser(JSON.parse(data));
      setIsLoading(false);
    });
    AsyncStorage.getItem("pendingVerificationEmail").then((email) => {
      if (email) setPendingVerificationEmail(email);
    });
  }, []);

  const signIn = async (email: string, _password: string) => {
    const stored = await AsyncStorage.getItem("users");
    const users: (User & { password?: string })[] = stored ? JSON.parse(stored) : [];
    const found = users.find((u) => u.email === email);
    if (!found) throw new Error("No account found with that email.");
    // In a real app, check emailVerified from backend. Here we simulate it as always verified after creation.
    await AsyncStorage.setItem("user", JSON.stringify(found));
    setUser(found);
    setPendingVerificationEmail(null);
    await AsyncStorage.removeItem("pendingVerificationEmail");
  };

  const signUp = async (data: { name: string; email: string; password: string }) => {
    const stored = await AsyncStorage.getItem("users");
    const users: (User & { password?: string })[] = stored ? JSON.parse(stored) : [];
    if (users.find((u) => u.email === data.email)) {
      throw new Error("An account with this email already exists.");
    }
    const newUser: User & { password?: string } = {
      id: Date.now().toString(),
      name: data.name,
      email: data.email,
      password: data.password,
      targetRole: "",
      experienceLevel: "",
      background: "",
      onboardingComplete: false,
      emailVerified: false,
    };
    users.push(newUser);
    await AsyncStorage.setItem("users", JSON.stringify(users));
    // Simulate email verification — in a real app a verification email is sent here
    // We store the user but don't log them in until "verified"
    setPendingVerificationEmail(data.email);
    await AsyncStorage.setItem("pendingVerificationEmail", data.email);
    await AsyncStorage.setItem("pendingUser", JSON.stringify(newUser));
  };

  const confirmEmailVerified = async () => {
    // Simulates clicking the email verification link
    const stored = await AsyncStorage.getItem("pendingUser");
    if (!stored) return;
    const pendingUser: User & { password?: string } = JSON.parse(stored);
    const verifiedUser: User = { ...pendingUser, emailVerified: true };
    // Update users list
    const usersStored = await AsyncStorage.getItem("users");
    const users: (User & { password?: string })[] = usersStored ? JSON.parse(usersStored) : [];
    const idx = users.findIndex((u) => u.id === verifiedUser.id);
    if (idx >= 0) users[idx] = { ...verifiedUser };
    await AsyncStorage.setItem("users", JSON.stringify(users));
    await AsyncStorage.setItem("user", JSON.stringify(verifiedUser));
    await AsyncStorage.removeItem("pendingVerificationEmail");
    await AsyncStorage.removeItem("pendingUser");
    setUser(verifiedUser);
    setPendingVerificationEmail(null);
  };

  const resendVerification = async () => {
    // In a real app, trigger a new verification email via backend
    // Here we just no-op to simulate the action
  };

  const completeOnboarding = async (background: string, experienceLevel: string, targetRole: string) => {
    if (!user) return;
    const updated: User = { ...user, background, experienceLevel, targetRole, onboardingComplete: true };
    const stored = await AsyncStorage.getItem("users");
    const users: (User & { password?: string })[] = stored ? JSON.parse(stored) : [];
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx >= 0) users[idx] = { ...users[idx], ...updated };
    await AsyncStorage.setItem("users", JSON.stringify(users));
    await AsyncStorage.setItem("user", JSON.stringify(updated));
    setUser(updated);
  };

  const signOut = async () => {
    await AsyncStorage.removeItem("user");
    setUser(null);
  };

  const updateUser = async (data: Partial<User>) => {
    if (!user) return;
    const updated = { ...user, ...data };
    const stored = await AsyncStorage.getItem("users");
    const users: (User & { password?: string })[] = stored ? JSON.parse(stored) : [];
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx >= 0) users[idx] = { ...users[idx], ...data };
    await AsyncStorage.setItem("users", JSON.stringify(users));
    await AsyncStorage.setItem("user", JSON.stringify(updated));
    setUser(updated);
  };

  return (
    <AuthContext.Provider value={{
      user, isLoading, pendingVerificationEmail,
      signIn, signUp, signOut, updateUser,
      completeOnboarding, resendVerification, confirmEmailVerified,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
