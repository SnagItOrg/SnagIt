import NewProductForm from '../NewProductForm'
import { yearDiscontinuedEnabled } from '@/lib/production-years'

export default function NewProductPage() {
  return <NewProductForm yearDiscontinuedEnabled={yearDiscontinuedEnabled()} />
}
