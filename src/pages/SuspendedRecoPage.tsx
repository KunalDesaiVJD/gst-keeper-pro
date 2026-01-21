import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText } from 'lucide-react';

const SuspendedRecoPage: React.FC = () => {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <FileText className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Suspended Reco</h1>
          <p className="text-muted-foreground">Suspended Reconciliation Records</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming Soon</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Suspended Reconciliation Module</h3>
            <p className="text-muted-foreground max-w-md">
              This module is under development. It will manage suspended reconciliation records that require additional verification or are pending resolution.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SuspendedRecoPage;
