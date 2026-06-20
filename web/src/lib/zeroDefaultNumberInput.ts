import type { FocusEvent } from 'react';
import { useEffect, useRef } from 'react';

/** Focus: xóa giá trị mặc định để gõ nhanh. Blur: trả lại nếu để trống. */
export function defaultNumberHandlers(
  value: string,
  onChange: (next: string) => void,
  defaultValue: string,
) {
  return {
    onFocus: (_e: FocusEvent<HTMLInputElement>) => {
      if (value === defaultValue) onChange('');
    },
    onBlur: (_e: FocusEvent<HTMLInputElement>) => {
      if (value.trim() === '') onChange(defaultValue);
    },
  };
}

/** @deprecated alias */
export const zeroDefaultNumberHandlers = defaultNumberHandlers;

/** Chuẩn hóa trước khi parse — tránh NaN khi blur chưa kịp chạy. */
export function parseDefaultNumber(raw: string, defaultValue: string): string {
  const trimmed = raw.trim();
  return trimmed === '' ? defaultValue : trimmed;
}

/** @deprecated alias */
export const parseZeroDefaultNumber = parseDefaultNumber;

/** Snapshot giá trị số khi dialog/sheet mở — dùng làm default blur/parse. */
export function useNumericDefaultsOnOpen<T extends Record<string, string>>(
  open: boolean,
  values: T,
): T {
  const ref = useRef(values);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      ref.current = values;
    }
    wasOpen.current = open;
  }, [open, values]);
  return ref.current;
}
