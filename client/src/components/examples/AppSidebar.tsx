import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "../AppSidebar";

export default function AppSidebarExample() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex w-full">
        <AppSidebar />
        <div className="flex-1 p-4">
          <p className="text-muted-foreground">Contenido principal aquí</p>
        </div>
      </div>
    </SidebarProvider>
  );
}
