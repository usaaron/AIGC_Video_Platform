import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createJsonSchemaValidator } from './jsonSchema.js'

describe('createJsonSchemaValidator', () => {
  it('validates UUID formats emitted by Zod JSON Schema', () => {
    const validate = createJsonSchemaValidator(z.object({ id: z.string().uuid() }), 'uuid.fixture')

    expect(validate({ id: '123e4567-e89b-42d3-a456-426614174000' })).toEqual({
      id: '123e4567-e89b-42d3-a456-426614174000',
    })
    expect(() => validate({ id: 'not-a-uuid' })).toThrow('uuid.fixture failed JSON Schema validation')
  })
})
