// Re-exporta desde el contexto compartido.
// Todos los componentes que importan useAuth obtienen el mismo estado de auth
// sin instancias duplicadas ni race conditions.
export { useAuth } from './AuthContext'
