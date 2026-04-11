[
  (method_declaration)
  (constructor_declaration)
  (anonymous_method_expression)
  (lambda_expression)
  (block)
] @local.scope

(parameter
  name: (identifier) @local.definition)

(local_declaration_statement
  (variable_declaration
    (variable_declarator
      name: (identifier) @local.definition)))

(identifier) @local.reference
