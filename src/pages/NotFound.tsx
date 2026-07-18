import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Compass, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.png";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center animate-fade-in">
        <div className="bg-white rounded-lg px-4 py-3 mb-6 inline-flex items-center justify-center shadow-sm border border-border">
          <img src={logo} alt="V. J. Desai & Co. LLP" className="h-9 w-auto object-contain" />
        </div>

        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Compass className="h-7 w-7 text-muted-foreground" />
        </div>

        <h1 className="mb-2 text-4xl font-bold text-foreground">404</h1>
        <p className="mb-2 text-lg font-medium text-foreground">
          This page isn&apos;t part of the GST Management System
        </p>
        <p className="mb-6 text-sm text-muted-foreground">
          We couldn&apos;t find <span className="font-mono text-foreground">{location.pathname}</span>.
          It may have been moved, or the link may be out of date.
        </p>

        <Button asChild>
          <Link to="/dashboard">
            <LayoutDashboard className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
