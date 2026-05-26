/**
 * ZhTWDatePicker — zh-TW localized date picker component.
 *
 * Replaces native <input type="date"> whose Chrome placeholder always shows
 * "mm/dd/yyyy" regardless of lang attribute (issue #2005 / #1988).
 *
 * Uses react-datepicker with zh-TW locale from date-fns.
 * Displays 年/月/日 placeholder and yyyy/MM/dd value format.
 */
import React from 'react';
import DatePicker from 'react-datepicker';
import { zhTW } from 'date-fns/locale';
import { format, parse, isValid } from 'date-fns';
import 'react-datepicker/dist/react-datepicker.css';

interface ZhTWDatePickerProps {
  /** ISO date string: "yyyy-MM-dd" or empty string */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Parse "yyyy-MM-dd" string to Date, return null if invalid/empty.
 */
function parseISODate(value: string): Date | null {
  if (!value) return null;
  const parsed = parse(value, 'yyyy-MM-dd', new Date());
  return isValid(parsed) ? parsed : null;
}

export const ZhTWDatePicker: React.FC<ZhTWDatePickerProps> = ({
  value,
  onChange,
  id,
  className,
  disabled,
}) => {
  const selectedDate = parseISODate(value);

  const handleChange = (date: Date | null) => {
    if (date && isValid(date)) {
      onChange(format(date, 'yyyy-MM-dd'));
    } else {
      onChange('');
    }
  };

  const displayValue = selectedDate ? format(selectedDate, 'yyyy/MM/dd') : '';

  return (
    <DatePicker
      id={id}
      selected={selectedDate}
      onChange={handleChange}
      locale={zhTW}
      dateFormat="yyyy/MM/dd"
      placeholderText="年/月/日"
      disabled={disabled}
      customInput={
        <input
          type="text"
          readOnly
          value={displayValue}
          placeholder="年/月/日"
          className={
            className ??
            'w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors cursor-pointer'
          }
        />
      }
    />
  );
};

export default ZhTWDatePicker;
