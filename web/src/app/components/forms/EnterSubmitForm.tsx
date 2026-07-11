import type { FormHTMLAttributes, ReactNode } from 'react';

type Props = Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> & {
  onSubmit: () => void | Promise<void>;
  children: ReactNode;
  disabled?: boolean;
};

/** Bọc form — Enter trong input gọi submit (chuẩn HTML). */
export function EnterSubmitForm({
  onSubmit,
  children,
  disabled,
  className,
  ...rest
}: Props) {
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        void onSubmit();
      }}
      {...rest}
    >
      {children}
    </form>
  );
}
