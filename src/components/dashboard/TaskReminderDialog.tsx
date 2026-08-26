import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Plus, Trash2, Loader2, ListTodo } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  TaskReminderRow, TaskReminderPatch,
  listTaskReminders, addTaskReminder, updateTaskReminder, deleteTaskReminder,
} from '@/lib/taskReminders';

const FREQUENCY_OPTIONS = ['One-time', 'Daily', 'Weekly', 'Monthly'];
const DUE_SOON_DAYS = 3;

interface TaskReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}

// yyyy-mm-dd for local "today", matching the <input type="date"> value format
// — comparing raw strings avoids timezone drift from Date parsing.
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const deadlineUrgencyClass = (deadline: string | null, isDone: boolean): string => {
  if (!deadline || isDone) return '';
  const today = todayStr();
  if (deadline < today) return 'bg-destructive/10 text-destructive';
  const soonCutoff = new Date();
  soonCutoff.setDate(soonCutoff.getDate() + DUE_SOON_DAYS);
  const soonStr = `${soonCutoff.getFullYear()}-${String(soonCutoff.getMonth() + 1).padStart(2, '0')}-${String(soonCutoff.getDate()).padStart(2, '0')}`;
  if (deadline <= soonStr) return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
  return '';
};

// A small Excel-like grid, private per staff member — every read/write is
// scoped to `userId` (see src/lib/taskReminders.ts for why that's the only
// privacy boundary; RLS on this table is open like every other table here).
export const TaskReminderDialog: React.FC<TaskReminderDialogProps> = ({ open, onOpenChange, userId }) => {
  const [rows, setRows] = useState<TaskReminderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskReminderRow | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listTaskReminders(userId)
      .then(setRows)
      .catch((err) => toast.error('Could not load your tasks: ' + (err instanceof Error ? err.message : 'unknown error')))
      .finally(() => setLoading(false));
  }, [open, userId]);

  // Most pressing deadline first; rows with no deadline sort to the end.
  // Done tasks fall to the bottom regardless, so the active list stays
  // focused on what's still outstanding.
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (a.is_done !== b.is_done) return a.is_done ? 1 : -1;
      if (!a.deadline && !b.deadline) return a.sort_order - b.sort_order;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
  }, [rows]);

  const patchRow = async (id: string, patch: TaskReminderPatch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setSavingId(id);
    try {
      await updateTaskReminder(id, userId, patch);
    } catch (err) {
      toast.error('Could not save: ' + (err instanceof Error ? err.message : 'unknown error'));
    } finally {
      setSavingId(null);
    }
  };

  const handleAddRow = async () => {
    const nextOrder = rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 0;
    try {
      const row = await addTaskReminder(userId, nextOrder);
      setRows((prev) => [...prev, row]);
    } catch (err) {
      toast.error('Could not add a row: ' + (err instanceof Error ? err.message : 'unknown error'));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    const prev = rows;
    setRows((r) => r.filter((row) => row.id !== target.id));
    try {
      await deleteTaskReminder(target.id, userId);
    } catch (err) {
      setRows(prev);
      toast.error('Could not delete: ' + (err instanceof Error ? err.message : 'unknown error'));
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTodo className="h-5 w-5" />
            My Task Reminders
          </DialogTitle>
          <DialogDescription>
            Private to you — no one else can see or edit these rows. Click any cell to edit.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto border rounded-md">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">Done</TableHead>
                  <TableHead className="min-w-[220px]">Task</TableHead>
                  <TableHead className="min-w-[160px]">Client</TableHead>
                  <TableHead className="min-w-[140px]">Reminder Frequency</TableHead>
                  <TableHead className="min-w-[150px]">Deadline for Submission</TableHead>
                  <TableHead className="min-w-[150px]">Task Allocated To</TableHead>
                  <TableHead className="min-w-[150px]">Task Received From</TableHead>
                  <TableHead className="min-w-[150px]">Ticket Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((row) => (
                  <TableRow key={row.id} className={row.is_done ? 'opacity-50' : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={row.is_done}
                        onCheckedChange={(checked) => patchRow(row.id, { is_done: checked === true })}
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        className="border-0 shadow-none focus-visible:ring-1 h-8"
                        defaultValue={row.task}
                        onBlur={(e) => e.target.value !== row.task && patchRow(row.id, { task: e.target.value })}
                        placeholder="Task…"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        className="border-0 shadow-none focus-visible:ring-1 h-8"
                        defaultValue={row.client}
                        onBlur={(e) => e.target.value !== row.client && patchRow(row.id, { client: e.target.value })}
                        placeholder="Client…"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Select
                        value={row.reminder_frequency || undefined}
                        onValueChange={(v) => patchRow(row.id, { reminder_frequency: v })}
                      >
                        <SelectTrigger className="border-0 shadow-none focus:ring-1 h-8">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {FREQUENCY_OPTIONS.map((f) => (
                            <SelectItem key={f} value={f}>{f}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="date"
                        className={cn('border-0 shadow-none focus-visible:ring-1 h-8 rounded', deadlineUrgencyClass(row.deadline, row.is_done))}
                        defaultValue={row.deadline || ''}
                        onBlur={(e) => e.target.value !== (row.deadline || '') && patchRow(row.id, { deadline: e.target.value || null })}
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        className="border-0 shadow-none focus-visible:ring-1 h-8"
                        defaultValue={row.allocated_to}
                        onBlur={(e) => e.target.value !== row.allocated_to && patchRow(row.id, { allocated_to: e.target.value })}
                        placeholder="Allocated to…"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        className="border-0 shadow-none focus-visible:ring-1 h-8"
                        defaultValue={row.received_from}
                        onBlur={(e) => e.target.value !== row.received_from && patchRow(row.id, { received_from: e.target.value })}
                        placeholder="Received from…"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        className="border-0 shadow-none focus-visible:ring-1 h-8"
                        defaultValue={row.ticket_status}
                        onBlur={(e) => e.target.value !== row.ticket_status && patchRow(row.id, { ticket_status: e.target.value })}
                        placeholder="Ticket status…"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(row)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!sortedRows.length && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                      No tasks yet — click "Add Task" to start your list.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <Button variant="outline" size="sm" onClick={handleAddRow}>
            <Plus className="h-4 w-4 mr-1" /> Add Task
          </Button>
          {savingId && <span className="text-xs text-muted-foreground">Saving…</span>}
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this task?</AlertDialogTitle>
          <AlertDialogDescription>
            {deleteTarget?.task ? `"${deleteTarget.task}"` : 'This task'} will be permanently removed. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
};

export default TaskReminderDialog;
