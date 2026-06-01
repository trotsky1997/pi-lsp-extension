[
  (method_declaration)
  (constructor_declaration)
  (lambda_expression)
  (block)
] @local.scope

(formal_parameter
  name: (identifier) @local.definition)

(local_variable_declaration
  declarator: (variable_declarator
    name: (identifier) @local.definition))

(catch_formal_parameter
  name: (identifier) @local.definition)

(identifier) @local.reference
