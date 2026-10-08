/**
 * 10 thay đổi phá vỡ cố ý (README mục 5, 8). Mỗi thay đổi có ba bộ sửa:
 *   truoc   — dev backend bản trước sửa DTO/controller và cả test của chính mình cho khớp (như thật);
 *   sauCode — dev backend bản sau sửa code; dùng một mình ở biến thể A ("quên sửa spec");
 *   spec    — sửa openapi.yaml cho khớp code; biến thể B = spec + sauCode ("sửa spec đúng quy trình nhưng phá vỡ").
 * Mỗi chuỗi `from` phải xuất hiện đúng một lần trong file (bench/lib.ts kiểm), để không sửa nhầm chỗ.
 */
export interface Edit {
  file: string;
  from: string;
  to: string;
}
export interface BreakingChange {
  id: number;
  key: string;
  title: string;
  truoc: Edit[];
  sauCode: Edit[];
  spec: Edit[];
  /** Chuỗi phải có trong output oasdiff để coi là "đỏ đúng chỗ". */
  diffMentions: string;
  /** Case hợp đồng phải đỏ ở biến thể A. */
  contractCase: string;
}

const T_DTO = 'apps/backend/src/truoc/customer.dto.ts';
const T_CTRL = 'apps/backend/src/truoc/customers.controller.ts';
const T_TEST = 'test/truoc-backend.test.ts';
const S_PRES = 'apps/backend/src/sau/customer.presenter.ts';
const S_CTRL = 'apps/backend/src/sau/customers.controller.ts';
const SPEC = 'packages/api-contract/openapi.yaml';
const REQUIRED = 'required: [id, name, email, phone, tier, address, tags, creditLimit, createdAt]';

export const CHANGES: BreakingChange[] = [
  {
    id: 1, key: 'rename-phone', title: 'Đổi tên phone → phoneNumber (response)',
    truoc: [
      { file: T_DTO, from: '  phone!: string | null;', to: '  phoneNumber!: string | null;' },
      { file: T_DTO, from: '      phone: r.phone,', to: '      phoneNumber: r.phone,' },
    ],
    sauCode: [
      { file: S_PRES, from: '  phone: string | null;', to: '  phoneNumber: string | null;' },
      { file: S_PRES, from: '      phone: r.phone,', to: '      phoneNumber: r.phone,' },
    ],
    spec: [
      { file: SPEC, from: '        phone:\n          # [PATTERN]', to: '        phoneNumber:\n          # [PATTERN]' },
      { file: SPEC, from: REQUIRED, to: REQUIRED.replace('phone,', 'phoneNumber,') },
    ],
    diffMentions: 'phone', contractCase: 'getCustomer 200',
  },
  {
    id: 2, key: 'remove-email', title: 'Bỏ trường email (response)',
    truoc: [
      { file: T_DTO, from: '  name!: string;\n  email!: string;\n  phone!', to: '  name!: string;\n  phone!' },
      { file: T_DTO, from: '      email: r.email,\n', to: '' },
    ],
    sauCode: [
      { file: S_PRES, from: '  email: string;\n', to: '' },
      { file: S_PRES, from: '      email: r.email,\n', to: '' },
    ],
    spec: [
      {
        file: SPEC,
        from: '        email:\n          type: string\n          format: email\n          description: Email liên hệ chính.\n        phone:\n          # [PATTERN]',
        to: '        phone:\n          # [PATTERN]',
      },
      { file: SPEC, from: REQUIRED, to: REQUIRED.replace(' email,', '') },
    ],
    diffMentions: 'email', contractCase: 'getCustomer 200',
  },
  {
    id: 3, key: 'tags-to-string', title: 'tags: mảng → chuỗi cách nhau bởi dấu phẩy',
    truoc: [
      { file: T_DTO, from: '  tags!: string[];', to: '  tags!: string;' },
      { file: T_DTO, from: '      tags: r.tags,', to: "      tags: r.tags.join(','),"},
    ],
    sauCode: [
      { file: S_PRES, from: '  tags: string[];', to: '  tags: string;' },
      { file: S_PRES, from: '      tags: r.tags,', to: "      tags: r.tags.join(','),"},
    ],
    spec: [
      {
        file: SPEC,
        from: '        tags:\n          type: array\n          description: Nhãn do sale gắn.\n          items:\n            type: string\n',
        to: '        tags:\n          type: string\n          description: Nhãn do sale gắn, cách nhau bởi dấu phẩy.\n',
      },
    ],
    diffMentions: 'tags', contractCase: 'getCustomer 200',
  },
  {
    id: 4, key: 'tier-uppercase', title: 'Giá trị enum tier viết hoa (gold → GOLD)',
    truoc: [
      { file: T_DTO, from: '  phone!: string | null;\n  tier!: CustomerTierValue;', to: '  phone!: string | null;\n  tier!: Uppercase<CustomerTierValue>;' },
      { file: T_DTO, from: '      tier: r.tier,', to: '      tier: r.tier.toUpperCase() as Uppercase<CustomerTierValue>,' },
    ],
    sauCode: [
      { file: S_PRES, from: '  tier: CustomerTierValue;', to: '  tier: Uppercase<CustomerTierValue>;' },
      { file: S_PRES, from: '      tier: r.tier,', to: '      tier: r.tier.toUpperCase() as Uppercase<CustomerTierValue>,' },
      { file: S_CTRL, from: 'phone: body.phone ?? null, tier: body.tier,', to: "phone: body.phone ?? null, tier: body.tier.toLowerCase() as CustomerTierValue," },
      { file: S_CTRL, from: "import { CustomerStore } from '../shared/customer-store.js';", to: "import { CustomerStore, type CustomerTierValue } from '../shared/customer-store.js';" },
    ],
    spec: [
      { file: SPEC, from: '      enum: [standard, gold, platinum]', to: '      enum: [STANDARD, GOLD, PLATINUM]' },
      { file: SPEC, from: '              tier: standard\n', to: '              tier: STANDARD\n' },
    ],
    diffMentions: 'tier', contractCase: 'getCustomer 200',
  },
  {
    id: 5, key: 'address-city-to-province', title: 'address.city → address.province (cả request và response)',
    truoc: [
      { file: T_DTO, from: '  address!: { line1: string; city: string };\n  tags!', to: '  address!: { line1: string; province: string };\n  tags!' },
      { file: T_DTO, from: '  address!: { line1: string; city: string };\n  tags?', to: '  address!: { line1: string; province: string };\n  tags?' },
      { file: T_DTO, from: 'city: r.billingCity }', to: 'province: r.billingCity }' },
      { file: T_CTRL, from: '!body.address?.city', to: '!body.address?.province' },
      { file: T_CTRL, from: 'billingCity: body.address.city', to: 'billingCity: body.address.province' },
      { file: T_TEST, from: "city: 'Hồ Chí Minh' }", to: "province: 'Hồ Chí Minh' }" },
    ],
    sauCode: [
      { file: S_PRES, from: '  address: { line1: string; city: string };', to: '  address: { line1: string; province: string };' },
      { file: S_PRES, from: 'city: r.billingCity }', to: 'province: r.billingCity }' },
      { file: S_CTRL, from: '  address: { line1: string; city: string };', to: '  address: { line1: string; province: string };' },
      { file: S_CTRL, from: 'billingCity: body.address.city', to: 'billingCity: body.address.province' },
    ],
    spec: [
      { file: SPEC, from: '      required: [line1, city]', to: '      required: [line1, province]' },
      { file: SPEC, from: '        city:\n          type: string\n          description: Tỉnh hoặc thành phố.', to: '        province:\n          type: string\n          description: Tỉnh hoặc thành phố.' },
      { file: SPEC, from: '                city: Hồ Chí Minh', to: '                province: Hồ Chí Minh' },
    ],
    diffMentions: 'city', contractCase: 'getCustomer 200',
  },
  {
    id: 6, key: 'name-nullable', title: 'name có thể null (khách doanh nghiệp chuyển sang legalName)',
    truoc: [
      { file: T_DTO, from: '  name!: string;\n  email!: string;\n  phone!', to: '  name!: string | null;\n  legalName!: string;\n  email!: string;\n  phone!' },
      { file: T_DTO, from: '      name: r.companyName,', to: '      name: r.taxCode ? null : r.companyName,\n      legalName: r.companyName,' },
    ],
    sauCode: [
      { file: S_PRES, from: '  name: string;', to: '  name: string | null;\n  legalName: string;' },
      { file: S_PRES, from: '      name: r.companyName,', to: '      name: r.taxCode ? null : r.companyName,\n      legalName: r.companyName,' },
    ],
    spec: [
      {
        file: SPEC,
        from: '        name:\n          type: string\n          description: Tên hiển thị của khách hàng.',
        to: '        name:\n          type: [string, "null"]\n          description: Tên hiển thị; null với khách doanh nghiệp (xem legalName).\n        legalName:\n          type: string\n          description: Tên pháp lý.',
      },
    ],
    diffMentions: 'name', contractCase: 'getCustomer 200',
  },
  {
    id: 7, key: 'createdAt-epoch', title: 'createdAt: chuỗi date-time → số giây Unix',
    truoc: [
      { file: T_DTO, from: '  createdAt!: string;', to: '  createdAt!: number;' },
      { file: T_DTO, from: '      createdAt: r.createdAt.toISOString(),', to: '      createdAt: Math.floor(r.createdAt.getTime() / 1000),' },
    ],
    sauCode: [
      { file: S_PRES, from: '  createdAt: string;', to: '  createdAt: number;' },
      { file: S_PRES, from: '      createdAt: r.createdAt.toISOString(),', to: '      createdAt: Math.floor(r.createdAt.getTime() / 1000),' },
    ],
    spec: [
      {
        file: SPEC,
        from: '        createdAt:\n          type: string\n          format: date-time\n          description: Thời điểm tạo, RFC 3339.',
        to: '        createdAt:\n          type: integer\n          description: Thời điểm tạo, Unix epoch (giây).',
      },
    ],
    diffMentions: 'createdAt', contractCase: 'getCustomer 200',
  },
  {
    id: 8, key: 'detail-envelope', title: 'Chi tiết bọc trong { data: ... }',
    truoc: [
      { file: T_CTRL, from: 'get(@Param(\'customerId\') customerId: string): CustomerDto {', to: 'get(@Param(\'customerId\') customerId: string): { data: CustomerDto } {' },
      { file: T_CTRL, from: '    return this.presenter.toDto(row);\n  }\n\n  @Post()', to: '    return { data: this.presenter.toDto(row) };\n  }\n\n  @Post()' },
      { file: T_TEST, from: 'const body = (await res.json()) as { id: string };\n    expect(body.id)', to: 'const body = (await res.json()) as { data: { id: string } };\n    expect(body.data.id)' },
    ],
    sauCode: [
      { file: S_CTRL, from: 'get(@Param(\'customerId\') customerId: string): CustomerBody {', to: 'get(@Param(\'customerId\') customerId: string): { data: CustomerBody } {' },
      { file: S_CTRL, from: '    return this.presenter.toBody(row);\n  }\n\n  /** operationId: createCustomer */', to: '    return { data: this.presenter.toBody(row) };\n  }\n\n  /** operationId: createCustomer */' },
    ],
    spec: [
      {
        file: SPEC,
        from: '          description: Khách hàng\n          content:\n            application/json:\n              schema:\n                $ref: "#/components/schemas/Customer"',
        to: '          description: Khách hàng\n          content:\n            application/json:\n              schema:\n                type: object\n                required: [data]\n                properties:\n                  data:\n                    $ref: "#/components/schemas/Customer"',
      },
    ],
    diffMentions: '/customers/{customerId}', contractCase: 'getCustomer 200',
  },
  {
    id: 9, key: 'require-taxCode', title: 'Request tạo khách hàng bắt buộc thêm taxCode',
    truoc: [
      { file: T_DTO, from: '  tags?: string[];\n}', to: '  tags?: string[];\n  taxCode!: string;\n}' },
      { file: T_CTRL, from: '!body.address?.city)', to: '!body.address?.city || !body.taxCode)' },
      { file: T_CTRL, from: 'taxCode: null,', to: 'taxCode: body.taxCode,' },
      { file: T_TEST, from: "tier: 'standard', address:", to: "tier: 'standard', taxCode: '0319999999', address:" },
    ],
    sauCode: [
      { file: S_CTRL, from: '  tags?: string[];\n}', to: '  tags?: string[];\n  taxCode: string;\n}' },
      { file: S_CTRL, from: "import { Body, Controller,", to: "import { BadRequestException, Body, Controller," },
      { file: S_CTRL, from: "    assertRequestBody('createCustomer', body); ", to: "    if (!body.taxCode) throw new BadRequestException('Thiếu taxCode');\n    assertRequestBody('createCustomer', body); " },
      { file: S_CTRL, from: 'taxCode: null,', to: 'taxCode: body.taxCode,' },
    ],
    spec: [
      { file: SPEC, from: '      required: [name, email, tier, address]', to: '      required: [name, email, tier, address, taxCode]' },
      { file: SPEC, from: '          description: Nhãn ban đầu.\n          items:\n            type: string\n', to: '          description: Nhãn ban đầu.\n          items:\n            type: string\n        taxCode:\n          type: string\n          description: Mã số thuế.\n' },
      { file: SPEC, from: '              tags: [b2b]\n', to: '              tags: [b2b]\n              taxCode: "0319999999"\n' },
    ],
    diffMentions: 'taxCode', contractCase: 'createCustomer 201',
  },
  {
    id: 10, key: 'rename-resource', title: 'Đổi tài nguyên /customers → /clients',
    truoc: [
      { file: T_CTRL, from: "@Controller('customers')", to: "@Controller('clients')" },
      { file: T_TEST, from: '/customers/cus_001', to: '/clients/cus_001' },
      { file: T_TEST, from: '/customers?limit=2', to: '/clients?limit=2' },
      { file: T_TEST, from: '/customers`, {', to: '/clients`, {' },
    ],
    sauCode: [{ file: S_CTRL, from: "@Controller('customers')", to: "@Controller('clients')" }],
    spec: [
      { file: SPEC, from: '  /customers:\n', to: '  /clients:\n' },
      { file: SPEC, from: '  /customers/{customerId}:\n', to: '  /clients/{customerId}:\n' },
    ],
    diffMentions: '/customers', contractCase: 'getCustomer 200',
  },
];
