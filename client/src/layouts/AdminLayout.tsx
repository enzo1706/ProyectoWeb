interface AdminLayoutProps {
  children: React.ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  return <div className="flex-1 bg-background">{children}</div>;
}
