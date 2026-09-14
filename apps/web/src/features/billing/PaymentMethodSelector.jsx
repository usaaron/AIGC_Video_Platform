import { CreditCard, MessageCircle } from 'lucide-react'
import { PAYMENT_METHODS } from './paymentClient'

export function PaymentMethodIcon({ method, size = 22 }) {
  return method === 'wechat' ? <MessageCircle size={size} /> : <CreditCard size={size} />
}

export function PaymentMethodSelector({ value, onChange, disabled, name, note }) {
  return (
    <section className="recharge-method" aria-label="支付方式">
      <h2>支付方式</h2>
      <fieldset className="payment-method-options" disabled={disabled}>
        <legend className="recharge-sr-only">支付方式</legend>
        {PAYMENT_METHODS.map((method) => (
          <label className={`payment-method-option ${method.id}`} key={method.id}>
            <input
              type="radio"
              name={name}
              value={method.id}
              checked={value === method.id}
              onChange={() => onChange(method.id)}
            />
            <PaymentMethodIcon method={method.id} />
            <strong>{method.label}</strong>
          </label>
        ))}
      </fieldset>
      <span>{note}</span>
    </section>
  )
}
