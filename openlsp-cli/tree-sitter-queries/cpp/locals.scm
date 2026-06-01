[
  (function_definition)
  (lambda_expression)
  (compound_statement)
] @local.scope

(parameter_declaration
  declarator: (identifier) @local.definition)

(parameter_declaration
  declarator: (reference_declarator
    (identifier) @local.definition))

(parameter_declaration
  declarator: (pointer_declarator
    (identifier) @local.definition))

(declaration
  declarator: (identifier) @local.definition)

(declaration
  declarator: (init_declarator
    declarator: (identifier) @local.definition))

(identifier) @local.reference
