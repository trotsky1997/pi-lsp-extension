[
  (function_declaration)
  (method_declaration)
  (block)
] @local.scope

(parameter_declaration
  name: (identifier) @local.definition)

(short_var_declaration
  left: (expression_list
    (identifier) @local.definition))

(var_spec
  name: (identifier) @local.definition)

(identifier) @local.reference
