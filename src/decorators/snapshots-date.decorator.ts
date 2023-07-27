/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ async: false })
export class IsValidDateConstraint implements ValidatorConstraintInterface {
  validate(date: string, args: ValidationArguments) {
    const [format] = args.constraints;
    const isValidFormat = /^\d{4}-\d{2}-\d{2}$/.test(date);
    if (!isValidFormat) return false;

    const dateInstance = new Date(date);
    return !isNaN(dateInstance.getTime());
  }

  defaultMessage(_args: ValidationArguments) {
    return 'Date must be in ISO format (YYYY-MM-DD) and represent a valid date.';
  }
}

export function IsValidDate(validationOptions?: ValidationOptions) {
  return function (object: Record<string, any>, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidDateConstraint,
    });
  };
}
