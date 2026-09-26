import { TextInput } from '#web/shared/ui/text-input.tsx';
import type { ReactNode } from 'react';

type LabKitTextFieldProps = {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: ReactNode;
};

/** A one-line text box laid out like the lab's sliders (label, box, hint under it), for words a piece shows. */
export function LabKitTextField({ label, value, onChange, hint }: LabKitTextFieldProps) {
  return (
    <TextInput label={label} labelProps={{ fw: 600, mb: 6 }} description={hint} inputWrapperOrder={['label', 'input', 'description']}
      size="sm" value={value} onChange={(e) => onChange(e.currentTarget.value)} />
  );
}
