import type { ComponentProps } from 'react';
import { Input } from '../ui/input';
import { cn } from '../ui/utils';

/** Field credential không phải login — tránh Edge/Chrome hỏi "Save password". */
const PM_IGNORE = {
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-form-type': 'other',
} as const;

type InputProps = ComponentProps<typeof Input>;

export function ClientApiKeyInput({ className, ...props }: InputProps) {
  return (
    <Input
      type="text"
      name="gw-client-api-key"
      autoComplete="one-time-code"
      spellCheck={false}
      className={cn(className)}
      {...PM_IGNORE}
      {...props}
    />
  );
}

/** Mask giống password nhưng type=text — browser không coi là mật khẩu đăng nhập. */
export function ClientSecretInput({ className, ...props }: InputProps) {
  return (
    <Input
      type="text"
      name="gw-client-hmac-secret"
      autoComplete="one-time-code"
      spellCheck={false}
      className={cn('gw-secret-mask', className)}
      {...PM_IGNORE}
      {...props}
    />
  );
}
