import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: "admin";
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      setLocation("/login");
      return;
    }

    if (requiredRole === "admin" && user.role !== "admin") {
      setLocation("/");
    }
  }, [user, isLoading, requiredRole, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[hsl(330,20%,98%)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  if (requiredRole === "admin" && user.role !== "admin") return null;

  return <>{children}</>;
}
