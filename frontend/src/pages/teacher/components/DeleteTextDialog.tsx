import React from 'react';
import ConfirmDialog from '../../../components/admin/ConfirmDialog';

interface DeleteTextDialogProps {
  open: boolean;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteTextDialog: React.FC<DeleteTextDialogProps> = ({
  open,
  isDeleting,
  onConfirm,
  onCancel,
}) => (
  <ConfirmDialog
    open={open}
    variant="destructive"
    title="確定要刪除這篇課文？"
    message="刪除後無法復原。"
    confirmLabel="確定刪除"
    isLoading={isDeleting}
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
);

export default DeleteTextDialog;
