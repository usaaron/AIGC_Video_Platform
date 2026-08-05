import Ajv from 'ajv/dist/2020.js'
import { z, type ZodTypeAny } from 'zod'

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  coerceTypes: false,
  strict: true,
  validateFormats: true,
  useDefaults: false,
})

ajv.addFormat('date-time', {
  type: 'string',
  validate: (value: string) => !Number.isNaN(Date.parse(value)) && value.includes('T'),
})
ajv.addFormat('email', {
  type: 'string',
  validate: (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
})
ajv.addFormat('uri', {
  type: 'string',
  validate: (value: string) => {
    try {
      return Boolean(new URL(value))
    } catch {
      return false
    }
  },
})
ajv.addFormat('uuid', {
  type: 'string',
  validate: (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value),
})

export function createJsonSchemaValidator<TSchema extends ZodTypeAny>(schema: TSchema, label: string) {
  const validate = ajv.compile(z.toJSONSchema(schema))
  return (value: unknown): z.infer<TSchema> => {
    if (validate(value)) return value as z.infer<TSchema>
    throw new Error(
      `${label} failed JSON Schema validation: ${ajv.errorsText(validate.errors, { separator: '; ' })}`,
    )
  }
}
