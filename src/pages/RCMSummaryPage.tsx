import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calculator } from 'lucide-react';

const RCMSummaryPage: React.FC = () => {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Calculator className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">RCM Summary</h1>
          <p className="text-muted-foreground">Reverse Charge Mechanism Summary</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming Soon</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Calculator className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">RCM Summary Module</h3>
            <p className="text-muted-foreground max-w-md">
              This module is under development. It will provide a comprehensive summary of Reverse Charge Mechanism (RCM) liabilities and input tax credits.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RCMSummaryPage;
